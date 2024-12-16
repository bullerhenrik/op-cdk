import { EventBridgeEvent } from "aws-lambda"
import {
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs"
import { mockClient } from "aws-sdk-client-mock"
import { Publisher } from "../lib/cloudwatch/log-alarm.Publisher"
import {
  CloudWatchAlarmEvent,
  Alert,
  Recipients,
} from "../lib/cloudwatch/types"

import {
  CloudWatchLogsClient,
  FilteredLogEvent,
  FilterLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs"
import { sub } from "date-fns"
import { beforeEach, describe, expect, test, vi } from "vitest"
import { Convert } from "../lib/cloudwatch/convert"

/*
eslint-disable no-useless-escape
 */

describe("LogAlarm publisher lambda", () => {
  let alarmEvent: EventBridgeEvent<string, CloudWatchAlarmEvent>
  let expectedAlert: Alert
  let logEvent: FilteredLogEvent
  const sqsMock = mockClient(SQSClient)
  const cloudWatchMock = mockClient(CloudWatchLogsClient)
  const epochNow = 1722348633322
  const mattermostMaxCharacterLimit = 16383 //TODO: check
  Date.now = vi.fn(() => epochNow)

  beforeEach(() => {
    sqsMock.reset()
    cloudWatchMock.reset()
    process.env = {}

    logEvent = {
      ingestionTime: sub(epochNow, { seconds: 30 }).getTime(),
      eventId: "some-log-event",
      logStreamName: "some-log-stream",
      timestamp: sub(epochNow, { minutes: 1 }).getTime(),
      message: JSON.stringify({
        message: "Parsing error",
        stacktrace:
          'Unrecognized field "wrongParameter" (class se.company.class.dto.SomeDto)',
      }),
    }

    alarmEvent = {
      id: "test-alert-id",
      "detail-type": "213123",
      resources: ["arn", "arn2"],
      region: "testregion",
      account: "TestAccount",
      source: "source",
      time: "2022-01-01T00:00:00.000Z",
      version: "0",
      detail: {
        alarmName: "TestErrorLogAlarm",
        configuration: {
          description: "My Description",
          metrics: [
            {
              id: "metricId1",
            },
          ],
        },
        previousState: {
          reason: "Reason",
          reasonData: "{}",
          timestamp: "2021-01-01T00:00:00.000+0000",
          value: "OK",
        },
        state: {
          reason: "Reason",
          reasonData: "{}",
          timestamp: "2024-07-30T14:12:32.835+0000",
          value: "ALARM",
        },
      },
    } as EventBridgeEvent<string, CloudWatchAlarmEvent>
    expectedAlert = {
      title: "Detected 1 error(s) in test-log-group",
      description: `Error message: Parsing error
[See error in CloudWatch](https://company.awsapps.com/start/#/console?account_id=TestAccount&role_name=CompanyReadOnly&destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fcloudwatch%2Fhome%3Fregion%3Dtestregion%23logsV2%3Alogs-insights%3FqueryDetail%3D~(end~${epochNow}~start~${sub(epochNow, { minutes: 5 }).getTime()}~timeType~'ABSOLUTE~unit~'minutes~editorString~'fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20filter*20level*3d*22ERROR*22*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*20200~source~(~'test-log-group)))`,
      id: "test-alert-id",
      priority: "P2",
      recipients: [
        {
          key: "opsgenieResponderTeam",
          value: "opsgenie-team1",
        },
        {
          key: "opsgenieResponderTeam",
          value: "opsgenie-team2",
        },
        {
          key: "mattermostChannelName",
          value: "test-mattermost-channel",
        },
        {
          key: "jiraTeamId",
          value: "jirTeamId",
        },
      ],
      source: "test-log-group",
      details: [
        {
          key: "account",
          value: "TestAccount",
        },
        {
          key: "alarmName",
          value: "TestErrorLogAlarm",
        },
        {
          key: "timestamp",
          value: "2024-07-30T14:12:32.835+0000",
        },
        {
          key: "stackTrace",
          value:
            '\n```\nUnrecognized field "wrongParameter" (class se.company.class.dto.SomeDto)\n```',
        },
      ],
      tags: ["AWS", "CloudwatchAlarm"],
    }
  })

  test("queueUrl reject throws", async () => {
    const sut = new Publisher({
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
    })

    sqsMock
      .on(GetQueueUrlCommand, {
        QueueName: "queue_name",
        QueueOwnerAWSAccountId: "test_account",
      })
      .rejects("error")

    await expect(sut.lambdaHandler(alarmEvent)).rejects.toThrow("error")
  })

  test("successfully put on sqs", async () => {
    const sut = new Publisher({
      TITLE: "Detected 1 error(s) in test-log-group",
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
      PRIORITY: "P2",
      SOURCE: "unit_test",

      FILTER_PATTERN: "{ $.['level'] = \"ERROR\" }",
      PERIOD: "5",
      LOG_GROUP_NAME: "test-log-group",
      ERROR_MESSAGE_PROPERTY: "message",
      STACK_TRACE_PROPERTY: "stacktrace",
      RECIPIENTS: JSON.stringify({
        mattermostChannelNames: ["test-mattermost-channel"],
        opsgenieTeams: ["opsgenie-team1", "opsgenie-team2"],
        jiraTeamIds: ["jirTeamId"],
      } as Recipients).toString(),
    })

    sqsMock
      .on(GetQueueUrlCommand, {
        QueueName: "queue_name",
        QueueOwnerAWSAccountId: "test_account",
      })
      .resolves({
        QueueUrl: "QueueUrl",
      })

    cloudWatchMock
      .on(FilterLogEventsCommand, {
        endTime: epochNow,
        filterPattern: "{ $.['level'] = \"ERROR\" }",
        limit: 1,
        logGroupName: "test-log-group",
        startTime: sub(epochNow, { minutes: 5 }).getTime(),
      })
      .resolves({
        events: [logEvent],
      })

    await sut.lambdaHandler(alarmEvent)

    const messageBody = Convert.alertToJson(expectedAlert)
    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 1)
    expect(sqsMock).toHaveReceivedCommandWith(SendMessageCommand, {
      QueueUrl: "QueueUrl",
      MessageBody: messageBody,
    })
  })

  test("no recipients", async () => {
    const sut = new Publisher({
      TITLE: "Detected 1 error(s) in test-log-group",
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
      PRIORITY: "P1",
      LOG_GROUP_NAME: "test-log-group",
    })

    sqsMock.on(GetQueueUrlCommand).resolves({
      QueueUrl: "QueueUrl",
    })

    await expect(sut.lambdaHandler(alarmEvent)).rejects.toThrow()

    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 0)
  })

  // pt. 2
  test("Skip stacktrace if not found", async () => {
    const sut = new Publisher({
      TITLE: "Detected 1 error(s) in test-log-group",
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
      PRIORITY: "P2",
      SOURCE: "unit_test",

      FILTER_PATTERN: "{ $.['level'] = \"ERROR\" }",
      PERIOD: "5",
      LOG_GROUP_NAME: "test-log-group",
      ERROR_MESSAGE_PROPERTY: "message",
      STACK_TRACE_PROPERTY: "stacktrace",
      RECIPIENTS: JSON.stringify({
        mattermostChannelNames: ["test-mattermost-channel"],
      }).toString(),
    })
    sqsMock
      .on(GetQueueUrlCommand, {
        QueueName: "queue_name",
        QueueOwnerAWSAccountId: "test_account",
      })
      .resolves({
        QueueUrl: "QueueUrl",
      })

    cloudWatchMock
      .on(FilterLogEventsCommand, {
        endTime: epochNow,
        filterPattern: "{ $.['level'] = \"ERROR\" }",
        limit: 1,
        logGroupName: "test-log-group",
        startTime: sub(epochNow, { minutes: 5 }).getTime(),
      })
      .resolves({
        events: [
          {
            ingestionTime: sub(epochNow, { seconds: 30 }).getTime(),
            eventId: "some-log-event",
            logStreamName: "some-log-stream",
            timestamp: sub(epochNow, { minutes: 1 }).getTime(),
            message: `{\"timestamp\": \"2024-07-29T11:32:55.794+0000UTC\",
            \"instant\": {\"epochSecond\": 1722252775, \"nanoOfSecond\": 794000000},
            \"thread\": \"main\",
            \"level\": \"ERROR\",
            \"loggerName\": \"se.company.applicaiton.SomeHandler\",
            \"message\": \"Parsing error\",
            \"xray_trace_id\": \"1-66a77de6-78a5ad3e2a6be682541749d0\"}`,
          },
        ],
      })

    await sut.lambdaHandler(alarmEvent)

    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 1)
    expect(sqsMock).toHaveReceivedCommandWith(SendMessageCommand, {
      QueueUrl: "QueueUrl",
      MessageBody: Convert.alertToJson({
        title: "Detected 1 error(s) in test-log-group",
        description: `Error message: Parsing error
[See error in CloudWatch](https://company.awsapps.com/start/#/console?account_id=TestAccount&role_name=CompanyReadOnly&destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fcloudwatch%2Fhome%3Fregion%3Dtestregion%23logsV2%3Alogs-insights%3FqueryDetail%3D~(end~${epochNow}~start~${sub(epochNow, { minutes: 5 }).getTime()}~timeType~'ABSOLUTE~unit~'minutes~editorString~'fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20filter*20level*3d*22ERROR*22*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*20200~source~(~'test-log-group)))`,
        id: "test-alert-id",
        priority: "P2",
        recipients: [
          {
            key: "mattermostChannelName",
            value: "test-mattermost-channel",
          },
        ],
        source: "test-log-group",
        details: [
          {
            key: "account",
            value: "TestAccount",
          },
          {
            key: "alarmName",
            value: "TestErrorLogAlarm",
          },
          {
            key: "timestamp",
            value: "2024-07-30T14:12:32.835+0000",
          },
        ],
        tags: ["AWS", "CloudwatchAlarm"],
      }),
    })
  })

  test("Skip error message if not found", async () => {
    const sut = new Publisher({
      TITLE: "Detected 1 error(s) in test-log-group",
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
      PRIORITY: "P2",
      SOURCE: "unit_test",

      FILTER_PATTERN: "{ $.['level'] = \"ERROR\" }",
      PERIOD: "5",
      LOG_GROUP_NAME: "test-log-group",
      ERROR_MESSAGE_PROPERTY: "message",
      STACK_TRACE_PROPERTY: "stacktrace",
      RECIPIENTS: JSON.stringify({
        mattermostChannelNames: ["test-mattermost-channel"],
      }).toString(),
    })

    sqsMock
      .on(GetQueueUrlCommand, {
        QueueName: "queue_name",
        QueueOwnerAWSAccountId: "test_account",
      })
      .resolves({
        QueueUrl: "QueueUrl",
      })

    cloudWatchMock
      .on(FilterLogEventsCommand, {
        endTime: epochNow,
        filterPattern: "{ $.['level'] = \"ERROR\" }",
        limit: 1,
        logGroupName: "test-log-group",
        startTime: sub(epochNow, { minutes: 5 }).getTime(),
      })
      .resolves({
        events: [
          {
            ingestionTime: sub(epochNow, { seconds: 30 }).getTime(),
            eventId: "some-log-event",
            logStreamName: "some-log-stream",
            timestamp: sub(epochNow, { minutes: 1 }).getTime(),
            message: `{\"timestamp\": \"2024-07-29T11:32:55.794+0000UTC\",
            \"instant\": {\"epochSecond\": 1722252775, \"nanoOfSecond\": 794000000},
            \"thread\": \"main\",
            \"level\": \"ERROR\",
            \"loggerName\": \"se.company.applicaiton.SomeHandler\",
            \"xray_trace_id\": \"1-66a77de6-78a5ad3e2a6be682541749d0\"}`,
          },
        ],
      })

    await sut.lambdaHandler(alarmEvent)

    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 1)
    expect(sqsMock).toHaveReceivedCommandWith(SendMessageCommand, {
      QueueUrl: "QueueUrl",
      MessageBody: Convert.alertToJson({
        title: "Detected 1 error(s) in test-log-group",
        description: `[See error in CloudWatch](https://company.awsapps.com/start/#/console?account_id=TestAccount&role_name=CompanyReadOnly&destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fcloudwatch%2Fhome%3Fregion%3Dtestregion%23logsV2%3Alogs-insights%3FqueryDetail%3D~(end~${epochNow}~start~${sub(epochNow, { minutes: 5 }).getTime()}~timeType~'ABSOLUTE~unit~'minutes~editorString~'fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20filter*20level*3d*22ERROR*22*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*20200~source~(~'test-log-group)))`,
        id: "test-alert-id",
        priority: "P2",
        recipients: [
          {
            key: "mattermostChannelName",
            value: "test-mattermost-channel",
          },
        ],
        source: "test-log-group",
        details: [
          {
            key: "account",
            value: "TestAccount",
          },
          {
            key: "alarmName",
            value: "TestErrorLogAlarm",
          },
          {
            key: "timestamp",
            value: "2024-07-30T14:12:32.835+0000",
          },
        ],
        tags: ["AWS", "CloudwatchAlarm"],
      }),
    })
  })

  // pt.3

  test("handle spring boot log format ok", async () => {
    const sut = new Publisher({
      TITLE: "Detected 1 error(s) in test-log-group",
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
      PRIORITY: "P2",
      SOURCE: "unit_test",

      FILTER_PATTERN: "{ $.['log.level'] = \"ERROR\" }",
      PERIOD: "5",
      LOG_GROUP_NAME: "test-log-group",
      ERROR_MESSAGE_PROPERTY: "error.message",
      STACK_TRACE_PROPERTY: "error.stack_trace",
      RECIPIENTS: JSON.stringify({
        mattermostChannelNames: ["test-mattermost-channel"],
      }).toString(),
    })

    sqsMock
      .on(GetQueueUrlCommand, {
        QueueName: "queue_name",
        QueueOwnerAWSAccountId: "test_account",
      })
      .resolves({
        QueueUrl: "QueueUrl",
      })

    cloudWatchMock
      .on(FilterLogEventsCommand, {
        endTime: epochNow,
        filterPattern: "{ $.['log.level'] = \"ERROR\" }",
        limit: 1,
        logGroupName: "test-log-group",
        startTime: sub(epochNow, { minutes: 5 }).getTime(),
      })
      .resolves({
        events: [
          {
            ingestionTime: sub(epochNow, { seconds: 30 }).getTime(),
            eventId: "some-log-event",
            logStreamName: "some-log-stream",
            timestamp: sub(epochNow, { minutes: 1 }).getTime(),
            message: `{
    "@timestamp": "2024-09-26T12:38:52.467Z",
    "log.level": "ERROR",
    "message": "Application run failed",
    "ecs.version": "1.2.0",
    "service.name": "some-application-bff",
    "event.dataset": "application.debug",
    "process.thread.name": "main",
    "log.logger": "org.springframework.boot.SpringApplication",
    "organization.id": "some-team",
    "service.id": "some-application-bff",
    "error.type": "org.springframework.beans.factory.UnsatisfiedDependencyException",
    "error.message": "Some error message",
    "error.stack_trace": "Some stack trace message"
}`,
          },
        ],
      })

    await sut.lambdaHandler(alarmEvent)

    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 1)
    expect(sqsMock).toHaveReceivedCommandWith(SendMessageCommand, {
      QueueUrl: "QueueUrl",
      MessageBody: Convert.alertToJson({
        title: "Detected 1 error(s) in test-log-group",
        description: `Error message: Some error message
[See error in CloudWatch](https://company.awsapps.com/start/#/console?account_id=TestAccount&role_name=CompanyReadOnly&destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fcloudwatch%2Fhome%3Fregion%3Dtestregion%23logsV2%3Alogs-insights%3FqueryDetail%3D~(end~${epochNow}~start~${sub(epochNow, { minutes: 5 }).getTime()}~timeType~'ABSOLUTE~unit~'minutes~editorString~'fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20filter*20log.level*3d*22ERROR*22*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*20200~source~(~'test-log-group)))`,
        id: "test-alert-id",
        priority: "P2",
        recipients: [
          {
            key: "mattermostChannelName",
            value: "test-mattermost-channel",
          },
        ],
        source: "test-log-group",
        details: [
          {
            key: "account",
            value: "TestAccount",
          },
          {
            key: "alarmName",
            value: "TestErrorLogAlarm",
          },
          {
            key: "timestamp",
            value: "2024-07-30T14:12:32.835+0000",
          },
          {
            key: "stackTrace",
            value: "\n```\nSome stack trace message\n```",
          },
        ],
        tags: ["AWS", "CloudwatchAlarm"],
      }),
    })
  })

  test("truncate stack traces longer than 15.000 characters", async () => {
    const sut = new Publisher({
      TITLE: "Detected 1 error(s) in test-log-group",
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
      PRIORITY: "P2",
      SOURCE: "unit_test",

      FILTER_PATTERN: "{ $.['log.level'] = \"ERROR\" }",
      PERIOD: "5",
      LOG_GROUP_NAME: "test-log-group",
      ERROR_MESSAGE_PROPERTY: "error.message",
      STACK_TRACE_PROPERTY: "error.stack_trace",
      RECIPIENTS: JSON.stringify({
        mattermostChannelNames: ["test-mattermost-channel"],
      }).toString(),
    })

    sqsMock
      .on(GetQueueUrlCommand, {
        QueueName: "queue_name",
        QueueOwnerAWSAccountId: "test_account",
      })
      .resolves({
        QueueUrl: "QueueUrl",
      })

    cloudWatchMock
      .on(FilterLogEventsCommand, {
        endTime: epochNow,
        filterPattern: "{ $.['log.level'] = \"ERROR\" }",
        limit: 1,
        logGroupName: "test-log-group",
        startTime: sub(epochNow, { minutes: 5 }).getTime(),
      })
      .resolves({
        events: [
          {
            ingestionTime: sub(epochNow, { seconds: 30 }).getTime(),
            eventId: "some-log-event",
            logStreamName: "some-log-stream",
            timestamp: sub(epochNow, { minutes: 1 }).getTime(),
            message: JSON.stringify({
              "@timestamp": "2024-09-26T12:38:52.467Z",
              "log.level": "ERROR",
              message: "Application run failed",
              "ecs.version": "1.2.0",
              "service.name": "some-application-bff",
              "event.dataset": "application.debug",
              "process.thread.name": "main",
              "log.logger": "org.springframework.boot.SpringApplication",
              "organization.id": "some-team",
              "service.id": "some-application-bff",
              "error.type":
                "org.springframework.beans.factory.UnsatisfiedDependencyException",
              "error.message": "Some error message",
              "error.stack_trace": "Some stack trace",
            }),
          },
        ],
      })

    await sut.lambdaHandler(alarmEvent)

    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 1)
    const sqsCommand = {
      QueueUrl: "QueueUrl",
      MessageBody: Convert.alertToJson({
        title: "Detected 1 error(s) in test-log-group",
        description: `Error message: Some error message
[See error in CloudWatch](https://company.awsapps.com/start/#/console?account_id=TestAccount&role_name=CompanyReadOnly&destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fcloudwatch%2Fhome%3Fregion%3Dtestregion%23logsV2%3Alogs-insights%3FqueryDetail%3D~(end~${epochNow}~start~${sub(epochNow, { minutes: 5 }).getTime()}~timeType~'ABSOLUTE~unit~'minutes~editorString~'fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20filter*20log.level*3d*22ERROR*22*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*20200~source~(~'test-log-group)))`,
        id: "test-alert-id",
        priority: "P2",
        recipients: [
          {
            key: "mattermostChannelName",
            value: "test-mattermost-channel",
          },
        ],
        source: "test-log-group",
        details: [
          {
            key: "account",
            value: "TestAccount",
          },
          {
            key: "alarmName",
            value: "TestErrorLogAlarm",
          },
          {
            key: "timestamp",
            value: "2024-07-30T14:12:32.835+0000",
          },
          {
            key: "stackTrace",
            value: "\n```\nSome stack trace\n```",
          },
        ],
        tags: ["AWS", "CloudwatchAlarm"],
      }),
    }

    const mattermostCodeBlock = /^\n?```\n?|\n?```\n?$/g
    const stackTrace = JSON.parse(sqsCommand.MessageBody)
      .details.find((d: { key: string }) => d.key === "stackTrace")
      .value.replace(mattermostCodeBlock, "")
      .trim()

    expect(sqsMock).toHaveReceivedCommandWith(SendMessageCommand, sqsCommand)
    expect(stackTrace.length).toBeLessThanOrEqual(13_000)
    expect(sqsCommand.MessageBody.length).toBeLessThanOrEqual(
      mattermostMaxCharacterLimit,
    )
  })

  test("truncate error messages longer than 2.000 characters", async () => {
    const sut = new Publisher({
      TITLE: "Detected 1 error(s) in test-log-group",
      QUEUE_ACCOUNT: "test_account",
      QUEUE_NAME: "queue_name",
      PRIORITY: "P2",
      SOURCE: "unit_test",

      FILTER_PATTERN: "{ $.['log.level'] = \"ERROR\" }",
      PERIOD: "5",
      LOG_GROUP_NAME: "test-log-group",
      ERROR_MESSAGE_PROPERTY: "error.message",
      STACK_TRACE_PROPERTY: "error.stack_trace",
      RECIPIENTS: JSON.stringify({
        mattermostChannelNames: ["test-mattermost-channel"],
      }).toString(),
    })

    sqsMock
      .on(GetQueueUrlCommand, {
        QueueName: "queue_name",
        QueueOwnerAWSAccountId: "test_account",
      })
      .resolves({
        QueueUrl: "QueueUrl",
      })

    cloudWatchMock
      .on(FilterLogEventsCommand, {
        endTime: epochNow,
        filterPattern: "{ $.['log.level'] = \"ERROR\" }",
        limit: 1,
        logGroupName: "test-log-group",
        startTime: sub(epochNow, { minutes: 5 }).getTime(),
      })
      .resolves({
        events: [
          {
            ingestionTime: sub(epochNow, { seconds: 30 }).getTime(),
            eventId: "some-log-event",
            logStreamName: "some-log-stream",
            timestamp: sub(epochNow, { minutes: 1 }).getTime(),
            message: JSON.stringify({
              "error.message": "Some error message",
              "error.stack_trace": "Some stack trace",
            }),
          },
        ],
      })
    await sut.lambdaHandler(alarmEvent)

    expect(sqsMock).toHaveReceivedCommandTimes(SendMessageCommand, 1)
    const cloudWatchLink = `[See error in CloudWatch](https://company.awsapps.com/start/#/console?account_id=TestAccount&role_name=CompanyReadOnly&destination=https%3A%2F%2Fconsole.aws.amazon.com%2Fcloudwatch%2Fhome%3Fregion%3Dtestregion%23logsV2%3Alogs-insights%3FqueryDetail%3D~(end~${epochNow}~start~${sub(epochNow, { minutes: 5 }).getTime()}~timeType~'ABSOLUTE~unit~'minutes~editorString~'fields*20*40timestamp*2c*20*40message*2c*20*40logStream*2c*20*40log*0a*7c*20filter*20log.level*3d*22ERROR*22*0a*7c*20sort*20*40timestamp*20desc*0a*7c*20limit*20200~source~(~'test-log-group)))`
    const alert: Alert = {
      title: "Detected 1 error(s) in test-log-group",
      description: `Error message: Some error message
${cloudWatchLink}`,
      id: "test-alert-id",
      priority: "P2",
      recipients: [
        {
          key: "mattermostChannelName",
          value: "test-mattermost-channel",
        },
      ],
      source: "test-log-group",
      details: [
        {
          key: "account",
          value: "TestAccount",
        },
        {
          key: "alarmName",
          value: "TestErrorLogAlarm",
        },
        {
          key: "timestamp",
          value: "2024-07-30T14:12:32.835+0000",
        },
        {
          key: "stackTrace",
          value: "\n```\nSome stack trace\n```",
        },
      ],
      tags: ["AWS", "CloudwatchAlarm"],
    } as Alert
    const sqsCommand = {
      QueueUrl: "QueueUrl",
      MessageBody: Convert.alertToJson(alert),
    }

    const mattermostCodeBlock = /^\n?```\n?|\n?```\n?$/g
    const stackTrace = JSON.parse(sqsCommand.MessageBody)
      .details.find((d: { key: string }) => d.key === "stackTrace")
      .value.replace(mattermostCodeBlock, "")
      .trim()
    const errorMessage = JSON.parse(sqsCommand.MessageBody)
      .description.replace(cloudWatchLink, "")
      .trim()

    expect(sqsMock).toHaveReceivedCommandWith(SendMessageCommand, sqsCommand)
    expect(stackTrace.length).toBeLessThanOrEqual(13_000)
    expect(errorMessage.length).toBeLessThanOrEqual(2_000)
    expect(sqsCommand.MessageBody.length).toBeLessThanOrEqual(
      mattermostMaxCharacterLimit,
    )
  })
})
