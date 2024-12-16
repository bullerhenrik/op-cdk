/* eslint-disable @typescript-eslint/no-explicit-any */
import { Duration, Stack } from "aws-cdk-lib"
import { IVpc } from "aws-cdk-lib/aws-ec2"
import {
  CfnLogGroup,
  FilterPattern,
  LogGroup,
  RetentionDays,
} from "aws-cdk-lib/aws-logs"
import { buildVpc } from "./test-utils"
import { Environment, Priority, Recipients } from "../lib/cloudwatch/types"
import {
  Alarm,
  CfnAlarm,
  ComparisonOperator,
  CreateAlarmOptions,
  MetricOptions,
} from "aws-cdk-lib/aws-cloudwatch"
import { Capture, Template } from "aws-cdk-lib/assertions"
import { LogAlarm } from "../lib/cloudwatch/log-alarm"

describe("LogAlarm", () => {
  let stack: Stack
  let vpc: IVpc
  let logGroup: LogGroup

  beforeEach(() => {
    stack = new Stack()
    vpc = buildVpc(stack)

    logGroup = new LogGroup(stack, "TestLogGroup", {
      logGroupName: "TestLogGroup",
    })
  })

  const testCases = [
    [
      {
        Description: "Error log alarm for TestLogGroup",
        Environment: Environment.Prod,
        AlertDetails: {
          Title: "Detected 1 error in: TestLogGroup",
          Priority: Priority.P1,
          Recipients: {
            mattermostChannelNames: ["error-log-alert-channel"],
          } as Recipients,
          ErrorMessageProperty: "message",
          StackTraceProperty: "thrown.message",
        },
        FilterPattern: FilterPattern.stringValue("$.['level']", "=", "ERROR"),
      },
      {
        Environment: {
          Variables: {
            ERROR_MESSAGE_PROPERTY: "message",
            FILTER_PATTERN: "{ $.['level'] = \"ERROR\" }",
            LOG_GROUP_NAME: {
              Ref: "TestLogGroup4EEF7AD4",
            },
            LOG_LEVEL: "INFO",
            RECIPIENTS:
              '{"mattermostChannelNames":["error-log-alert-channel"]}',
            PRIORITY: "P1",
            QUEUE_ACCOUNT: "123456789012",
            QUEUE_NAME: "TestQueueName",
            SOURCE: {
              Ref: "TestLogGroup4EEF7AD4",
            },
            STACK_TRACE_PROPERTY: "thrown.message",
          },
        },
        AlarmDescription: "Error log alarm for TestLogGroup",
        KmsKeyId: "1064f6db-34e1-46bd-8ce2-33b1d00a8f1a",
        FilterPattern: "{ $.['level'] = \"ERROR\" }",
      },
    ],
    [
      {
        Description: "Warning log alarm for TestLogGroup",
        Environment: Environment.Prod,
        AlertDetails: {
          Title: "Detected 1 error in: TestLogGroup",
          Priority: Priority.P2,
          Recipients: {
            mattermostChannelNames: ["error-log-alert-channel"],
            opsgenieTeams: ["opsgenie-team1", "opsgenie-team2"],
          } as Recipients,
          ErrorMessageProperty: "message",
          StackTraceProperty: "thrown.message",
        },
        FilterPattern: FilterPattern.stringValue(
          "$.['log.level']",
          "=",
          "WARN",
        ),
      },
      {
        Environment: {
          Variables: {
            ERROR_MESSAGE_PROPERTY: "message",
            FILTER_PATTERN: "{ $.['log.level'] = \"WARN\" }",
            LOG_GROUP_NAME: {
              Ref: "TestLogGroup4EEF7AD4",
            },
            LOG_LEVEL: "INFO",
            RECIPIENTS:
              '{"mattermostChannelNames":["error-log-alert-channel"],"opsgenieTeams":["opsgenie-team1","opsgenie-team2"]}',
            PRIORITY: "P2",
            QUEUE_ACCOUNT: "123456789012",
            QUEUE_NAME: "TestQueueName",
            SOURCE: {
              Ref: "TestLogGroup4EEF7AD4",
            },
            STACK_TRACE_PROPERTY: "thrown.message",
          },
        },
        KmsKeyId: "1064f6db-34e1-46bd-8ce2-33b1d00a8f1a",
        FilterPattern: "{ $.['log.level'] = \"WARN\" }",
        AlarmDescription: "Warning log alarm for TestLogGroup",
      },
    ],
    [
      {
        Description: "Phrase log alarm for TestLogGroup",
        Environment: Environment.Prod,
        AlertDetails: {
          Title: "Detected 1 error in: TestLogGroup",
          Priority: Priority.P3,
          Recipients: {
            mattermostChannelNames: ["error-log-alert-channel"],
          } as Recipients,
          ErrorMessageProperty: "message",
          StackTraceProperty: "thrown.message",
        },
        FilterPattern: FilterPattern.stringValue(
          "$.['message']",
          "=",
          "Some custom phrase",
        ),
      },
      {
        Environment: {
          Variables: {
            ERROR_MESSAGE_PROPERTY: "message",
            FILTER_PATTERN: "{ $.['message'] = \"Some custom phrase\" }",
            LOG_GROUP_NAME: {
              Ref: "TestLogGroup4EEF7AD4",
            },
            LOG_LEVEL: "INFO",
            RECIPIENTS:
              '{"mattermostChannelNames":["error-log-alert-channel"]}',
            PRIORITY: "P3",
            QUEUE_ACCOUNT: "123456789012",
            QUEUE_NAME: "TestQueueName",
            SOURCE: {
              Ref: "TestLogGroup4EEF7AD4",
            },
            STACK_TRACE_PROPERTY: "thrown.message",
          },
        },
        KmsKeyId: "1064f6db-34e1-46bd-8ce2-33b1d00a8f1a",
        FilterPattern: "{ $.['message'] = \"Some custom phrase\" }",
        AlarmDescription: "Phrase log alarm for TestLogGroup",
      },
    ],
  ]

  it.each(testCases)(
    "create metric filter with correct properties",
    (input: any, expectedProps: any) => {
      const logAlarm = createLogAlarm(input)
      const cfnLogGroup = logGroup.node.defaultChild as CfnLogGroup
      const logGroupLogicalId = stack.getLogicalId(cfnLogGroup)

      expect(logAlarm.alarm).toBeDefined()
      expect(logAlarm.alarm).toBeInstanceOf(Alarm)

      const template = Template.fromStack(stack)

      template.hasResourceProperties("AWS::Logs::MetricFilter", {
        FilterPattern: expectedProps.FilterPattern,
        LogGroupName: { Ref: logGroupLogicalId },
      })
    },
  )

  it.each(testCases)(
    "create alarm with correct properties",
    (input: any, expectedProps: any) => {
      const logAlarm = createLogAlarm(input)

      expect(logAlarm.alarm).toBeDefined()
      expect(logAlarm.alarm).toBeInstanceOf(Alarm)

      const template = Template.fromStack(stack)

      template.hasResourceProperties("AWS::CloudWatch::Alarm", {
        ComparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
        AlarmDescription: expectedProps.AlarmDescription,
        EvaluationPeriods: 1,
        MetricName: "LogFilter",
        Namespace: { Ref: "TestLogGroup4EEF7AD4" },
        Period: 300,
        Statistic: "Average",
        Threshold: 0,
      })
    },
  )

  it.each(testCases)(
    "create lambda with correct properties and permissions",
    (input: any, expectedProps: any) => {
      const logAlarm = createLogAlarm(input)

      expect(logAlarm.alarm).toBeDefined()
      expect(logAlarm.alarm).toBeInstanceOf(Alarm)

      const template = Template.fromStack(stack)

      const lambdaRoleCapture = new Capture()
      const logsArnCapture = new Capture()
      const queueArnCapture = new Capture()
      const kmsArnCapture = new Capture()

      template.hasResourceProperties("AWS::Lambda::Function", {
        Runtime: "nodejs18.x",
        Timeout: 120,
        Environment: expectedProps.Environment,
        Role: { "Fn::GetAtt": [lambdaRoleCapture, "Arn"] },
      })

      const policies = template.findResources("AWS::IAM::Policy", {
        Properties: {
          PolicyDocument: {
            Statement: [
              {
                Effect: "Allow",
                Action: [
                  "logs:FilterLogEvents",
                  "logs:GetLogEvents",
                  "logs:GetLogGroupFields",
                  "logs:DescribeLogGroups",
                  "logs:DescribeLogStreams",
                ],
                Resource: logsArnCapture,
              },
              {
                Effect: "Allow",
                Action: [
                  "sqs:SendMessage",
                  "sqs:GetQueueAttributes",
                  "sqs:GetQueueUrl",
                ],
                Resource: queueArnCapture,
              },
              {
                Effect: "Allow",
                Action: [
                  "kms:Decrypt",
                  "kms:Encrypt",
                  "kms:ReEncrypt*",
                  "kms:GenerateDataKey*",
                ],
                Resource: kmsArnCapture,
              },
            ],
          },
          Roles: [
            {
              Ref: lambdaRoleCapture,
            },
          ],
        },
      })

      expect(Object.keys(policies).length).toBe(1)
      expect(queueArnCapture.asObject()["Fn::Join"][1][2]).toBe(
        `:${input.Environment}:TestQueueName`,
      )
      expect(kmsArnCapture.asObject()["Fn::Join"][1][2]).toMatch(
        `:${input.Environment}:key/${expectedProps.KmsKeyId}`,
      )
    },
  )

  it.each(testCases)(
    "create event rule with correct properties",
    (input: any, expectedProps: any) => {
      const logAlarm = createLogAlarm(input)
      const cfnAlarm = logAlarm.alarm.node.defaultChild as CfnAlarm
      const alarmLogicalId = stack.getLogicalId(cfnAlarm)

      expect(logAlarm.alarm).toBeDefined()
      expect(logAlarm.alarm).toBeInstanceOf(Alarm)

      const template = Template.fromStack(stack)

      const fn = template.findResources("AWS::Lambda::Function", {
        Properties: {
          Environment: expectedProps.Environment,
        },
      })

      const eventRuleTarget = new Capture()
      template.hasResourceProperties("AWS::Events::Rule", {
        EventPattern: {
          source: ["aws.cloudwatch"],
          "detail-type": ["CloudWatch Alarm State Change"],
          resources: [{ "Fn::GetAtt": [alarmLogicalId, "Arn"] }],
          detail: {
            state: {
              value: ["ALARM"],
            },
          },
        },
        Targets: [
          {
            Arn: {
              "Fn::GetAtt": [eventRuleTarget, "Arn"],
            },
          },
        ],
      })

      expect(Object.keys(fn).length).toBe(1)
      expect(Object.keys(fn)[0]).toBe(eventRuleTarget.asString())
    },
  )

  test("no recipients fails", () => {
    expect(() => {
      new LogAlarm(stack, "ErrorLogAlarm", {
        description: "Error log alarm for TestLogGroup",
        alertDetails: {
          title: "Detected 1 error in: TestLogGroup",
          priority: Priority.P1,
          errorMessageProperty: "message",
          stackTraceProperty: "thrown.message",
          recipients: {},
        },
        filterPattern: FilterPattern.stringValue("$.['level']", "=", "ERROR"),
        logGroup: logGroup,
        vpc: vpc,
      })
    }).toThrow("Must have at least one Recipient")
  })
  // pt. 2

  it.each(testCases)("create alarm with custom properties", (input: any) => {
    const createAlarmOptions: CreateAlarmOptions = {
      comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      datapointsToAlarm: 1,
      evaluationPeriods: 10,
      threshold: 5,
    }

    const logAlarm = createLogAlarm(input, createAlarmOptions)
    expect(logAlarm.alarm).toBeDefined()
    expect(logAlarm.alarm).toBeInstanceOf(Alarm)

    const template = Template.fromStack(stack)

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      ComparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
      DatapointsToAlarm: 1,
      EvaluationPeriods: 10,
      MetricName: "LogFilter",
      Namespace: { Ref: "TestLogGroup4EEF7AD4" },
      Period: 300,
      Statistic: "Average",
      Threshold: 5,
    })
  })

  it.each(testCases)("create alarm with custom metrics", (input: any) => {
    const metricOptions: MetricOptions = {
      period: Duration.minutes(10),
    }

    const logAlarm = createLogAlarm(input, undefined, metricOptions)
    expect(logAlarm.alarm).toBeDefined()
    expect(logAlarm.alarm).toBeInstanceOf(Alarm)

    const template = Template.fromStack(stack)

    template.hasResourceProperties("AWS::CloudWatch::Alarm", {
      ComparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      EvaluationPeriods: 1,
      MetricName: "LogFilter",
      Namespace: { Ref: "TestLogGroup4EEF7AD4" },
      Period: 600,
      Statistic: "Average",
      Threshold: 0,
    })
  })

  it("No custom resource is created for handling LogGroup retention", () => {
    const logAlarmProps = {
      Description: "Error log alarm for TestLogGroup",
      AlertDetails: {
        Title: "Detected 1 error in: TestLogGroup",
        Priority: Priority.P1,
        ErrorMessageProperty: "message",
        StackTraceProperty: "thrown.message",
        Recipients: {
          mattermostChannelNames: ["error-log-alert-channel"],
        } as Recipients,
      },
      FilterPattern: FilterPattern.stringValue("$.['level']", "=", "ERROR"),
      LogGroup: logGroup,
      Vpc: vpc,
    }
    const logAlarm = createLogAlarm(logAlarmProps)
    expect(logAlarm.alarm).toBeDefined()
    expect(logAlarm.alarm).toBeInstanceOf(Alarm)

    const template = Template.fromStack(stack)
    template.resourceCountIs("Custom::LogRetention", 0)
  })

  it("A LogGroup is created for Publisher Lambda", () => {
    const logAlarmProps = {
      Description: "Error log alarm for TestLogGroup",
      AlertDetails: {
        Title: "Detected 1 error in: TestLogGroup",
        Priority: Priority.P1,
        ErrorMessageProperty: "message",
        StackTraceProperty: "thrown.message",
        Recipients: {
          mattermostChannelNames: ["error-log-alert-channel"],
        } as Recipients,
      },
      FilterPattern: FilterPattern.stringValue("$.['level']", "=", "ERROR"),
      LogGroup: logGroup,
      Vpc: vpc,
    }
    const logAlarm = createLogAlarm(logAlarmProps)
    expect(logAlarm.alarm).toBeDefined()
    expect(logAlarm.alarm).toBeInstanceOf(Alarm)

    const template = Template.fromStack(stack)
    template.resourceCountIs("AWS::Logs::LogGroup", 2)
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: 30,
    })
  })

  it("Use provided LogGroup for Publisher Lambda", () => {
    const logAlarmProps = {
      Description: "Error log alarm for TestLogGroup",
      AlertDetails: {
        Title: "Detected 1 error in: TestLogGroup",
        Priority: Priority.P1,
        ErrorMessageProperty: "message",
        StackTraceProperty: "thrown.message",
        Recipients: {
          mattermostChannelNames: ["error-log-alert-channel"],
        } as Recipients,
      },
      FilterPattern: FilterPattern.stringValue("$.['level']", "=", "ERROR"),
      LogGroup: logGroup,
      PublisherLogGroup: new LogGroup(stack, "PublisherLogGroup", {
        logGroupName: "customLogGroup",
        retention: RetentionDays.ONE_WEEK,
      }),
      Vpc: vpc,
    }
    const logAlarm = createLogAlarm(logAlarmProps)
    expect(logAlarm.alarm).toBeDefined()
    expect(logAlarm.alarm).toBeInstanceOf(Alarm)

    const template = Template.fromStack(stack)
    template.resourceCountIs("AWS::Logs::LogGroup", 2)
    template.hasResourceProperties("AWS::Logs::LogGroup", {
      RetentionInDays: RetentionDays.ONE_WEEK,
      LogGroupName: "customLogGroup",
    })
  })

  function createLogAlarm(
    input: any,
    alarmProps?: CreateAlarmOptions,
    metricProps?: MetricOptions,
  ) {
    return new LogAlarm(stack, "ErrorLogAlarm", {
      description: input.Description,
      environment: input.Environment,
      alertDetails: {
        title: input.AlertDetails.Title,
        priority: input.AlertDetails.Priority,
        recipients: input.AlertDetails.Recipients,
        errorMessageProperty: input.AlertDetails.ErrorMessageProperty,
        stackTraceProperty: input.AlertDetails.StackTraceProperty,
      },
      filterPattern: input.FilterPattern,
      logGroup: logGroup,
      publisherLogGroup: input.PublisherLogGroup,
      vpc: vpc,
      alarmProps: alarmProps,
      metricProps: metricProps,
    })
  }
})
