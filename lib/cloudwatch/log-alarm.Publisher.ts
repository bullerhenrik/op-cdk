/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
  CloudWatchLogsClient,
  FilterLogEventsCommand,
  FilterLogEventsResponse,
} from "@aws-sdk/client-cloudwatch-logs"
import {
  GetQueueUrlCommand,
  SendMessageCommand,
  SQSClient,
} from "@aws-sdk/client-sqs"
import { Logger } from "@aws-lambda-powertools/logger"
import { injectLambdaContext } from "@aws-lambda-powertools/logger/middleware"
import { sub } from "date-fns"
import middy from "@middy/core"
import errorLogger from "@middy/error-logger"
import { stringify } from "jsurl"
import { EventBridgeEvent } from "aws-lambda"
import {
  Alert,
  CloudWatchAlarmEvent,
  Detail,
  Recipient,
  Recipients,
} from "./types"
import { Convert } from "./convert"

const logger = new Logger()

export class Publisher {
  private readonly queueName: string
  private readonly queueAccount: string
  private readonly priority: string
  private readonly filterPattern: string
  private readonly logGroupName: string
  private readonly errorMessageProperty: string
  private readonly stackTraceProperty: string
  private readonly title: string
  private readonly recipients: Recipients

  private queueUrl: string

  private endTime: number
  private startTime: number

  private sqs: SQSClient
  private cloudWatch: CloudWatchLogsClient

  private periodMinutes: number

  constructor(env: Record<string, string | undefined>) {
    this.queueAccount = env.QUEUE_ACCOUNT!
    this.queueName = env.QUEUE_NAME!
    this.priority = env.PRIORITY ?? "P1"

    this.title = env.TITLE!
    this.filterPattern = env.FILTER_PATTERN!
    this.logGroupName = env.LOG_GROUP_NAME!
    this.errorMessageProperty = env.ERROR_MESSAGE_PROPERTY ?? ""
    this.stackTraceProperty = env.STACK_TRACE_PROPERTY ?? ""
    this.periodMinutes = +env.PERIOD!
    this.recipients = env.RECIPIENTS ? JSON.parse(env.RECIPIENTS!) : {}

    this.sqs = new SQSClient({
      region: env.AWS_REGION!,
    })

    this.cloudWatch = new CloudWatchLogsClient({
      region: env.AWS_REGION!,
    })
  }

  async lambdaHandler(event: EventBridgeEvent<string, CloudWatchAlarmEvent>) {
    if (!this.queueUrl) {
      this.queueUrl = await this.getQueueUrl()
    }

    this.endTime = Date.now()
    this.startTime = sub(this.endTime, {
      minutes: this.periodMinutes,
    }).getTime()

    const log = await this.getLogEventMessage()

    const cloudWatchURL = this.createCloudWatchURL(event)

    const alert = this.createAlert(event, cloudWatchURL, log)

    logger.info("Sending to SQS", { payload: alert, queueUrl: this.queueUrl })

    return this.sqs.send(
      new SendMessageCommand({
        QueueUrl: this.queueUrl,
        MessageBody: Convert.alertToJson(alert),
      }),
    )
  }

  private createAlert(
    event: EventBridgeEvent<string, CloudWatchAlarmEvent>,
    cloudWatchURL: string,
    log: string,
  ) {
    let errorMessage = undefined
    let stackTrace = undefined

    if (log) {
      errorMessage = this.getPropertyValue(this.errorMessageProperty, log)
      stackTrace = this.getPropertyValue(this.stackTraceProperty, log)
    }

    const recipients: Recipient[] = []

    const opsgenieRecipients: Recipient[] =
      this.recipients.opsgenieTeams?.map((opsgenieTeamId) => ({
        key: "opsgenieResponderTeam",
        value: opsgenieTeamId,
      })) || []

    const mattermostRecipients: Recipient[] =
      this.recipients.mattermostChannelNames?.map((channelName) => ({
        key: "mattermostChannelName",
        value: channelName,
      })) || []

    const jiraRecipients: Recipient[] =
      this.recipients.jiraTeamIds?.map((jiraTeamId) => ({
        key: "jiraTeamId",
        value: jiraTeamId,
      })) || []

    recipients.push(
      ...opsgenieRecipients,
      ...mattermostRecipients,
      ...jiraRecipients,
    )

    const details = [
      {
        key: "account",
        value: event.account,
      },
      {
        key: "alarmName",
        value: event.detail.alarmName,
      },
      {
        key: "timestamp",
        value: event.detail.state.timestamp,
      },
    ]

    const additionalDetails: Detail[] = this.readAdditionalDetails()

    const alert: Alert = {
      title: this.title,
      description: !errorMessage
        ? `[See error in CloudWatch](${cloudWatchURL})`
        : `Error message: ${this.truncateString(errorMessage, 2_000)}\n[See error in CloudWatch](${cloudWatchURL})`,
      id: event.id,
      priority: this.priority,
      recipients: recipients,
      source: this.logGroupName,
      details: !stackTrace
        ? details
        : details.concat(additionalDetails, [
            { key: "stackTrace", value: this.insertIntoCodeBlock(stackTrace) },
          ]),
      tags: ["AWS", "CloudwatchAlarm"],
    }
    return alert
  }

  private createCloudWatchURL(
    event: EventBridgeEvent<string, CloudWatchAlarmEvent>,
  ) {
    const filterCondition = this.convertToLogInsightsFormat(this.filterPattern)
    const logInsightsQuery = {
      end: this.endTime,
      start: this.startTime,
      timeType: "ABSOLUTE",
      unit: "minutes",
      editorString: `fields @timestamp, @message, @logStream, @log
| filter ${filterCondition}
| sort @timestamp desc
| limit 200`,
      source: [this.logGroupName],
    }

    const destination = encodeURIComponent(
      `https://console.aws.amazon.com/cloudwatch/home?region=${event.region}#logsV2:logs-insights?queryDetail=${stringify(logInsightsQuery)}`,
    )
    return encodeURI(
      `https://company.awsapps.com/start/#/console?account_id=${event.account}&role_name=CompanyReadOnly&destination=`,
    ).concat(destination)
  }

  private convertToLogInsightsFormat(input: string): string {
    // Remove the outer curly braces and spaces
    let cleaned = input.trim().replace(/^\{|}$/g, "")

    // Remove the $. prefix and square brackets
    cleaned = cleaned.replace(/\$\.\['/g, "").replace(/']/g, "")

    // Remove any remaining spaces
    cleaned = cleaned.replace(/\s+/g, "")

    return cleaned
  }

  private async getLogEventMessage() {
    let message: string = ""
    try {
      const response: FilterLogEventsResponse = await this.cloudWatch.send(
        new FilterLogEventsCommand({
          endTime: this.endTime,
          filterPattern: this.filterPattern,
          limit: 1,
          logGroupName: this.logGroupName,
          startTime: this.startTime,
        }),
      )

      const logEvent = response.events?.[0]

      if (!logEvent || !logEvent.message) {
        logger.warn("No log events found or log event message is missing")
        return ""
      }

      message = JSON.parse(logEvent.message)
    } catch (e) {
      logger.error("Error getting log event", { error: e })
    }
    return message
  }

  //eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getPropertyValue(path: string, obj: any) {
    if (path in obj) {
      return obj[path]
    }

    return path.split(".").reduce((prev, curr) => prev?.[curr], obj)
  }

  /**
   * Inserts stack trace into code block. Truncates code larger than 13.000 characters to satisfy mattermost max limit of 16.383 characters.
   * @param code
   * @private
   */
  private insertIntoCodeBlock(code: string) {
    return `\n\`\`\`\n${this.truncateString(code, 13_000)}\n\`\`\``
  }

  async getQueueUrl() {
    const queueUrlResp = await this.sqs.send(
      new GetQueueUrlCommand({
        QueueName: this.queueName,
        QueueOwnerAWSAccountId: this.queueAccount,
      }),
    )

    if (!queueUrlResp.QueueUrl) {
      throw new Error("no notification queue url!")
    }
    return queueUrlResp.QueueUrl
  }

  readAdditionalDetails(): Detail[] {
    const details: Detail[] = []

    for (let i = 0; ; i++) {
      const key = process.env[`DETAIL_${i}_KEY`]
      const value = process.env[`DETAIL_${i}_VALUE`]

      if (!key || !value) {
        break
      }
      details.push({ key, value })
    }
    return details
  }

  truncateString(str: string, maxLength: number): string {
    if (str.length <= maxLength) {
      return str
    }

    return str.slice(0, maxLength - 3) + "..."
  }
}

const publisher = new Publisher(process.env)

export const handler = middy(
  (event: EventBridgeEvent<string, CloudWatchAlarmEvent>) => {
    return publisher.lambdaHandler(event)
  },
)
  .use(
    injectLambdaContext(logger, {
      clearState: true,
      logEvent: true,
    }),
  )
  .use(
    errorLogger({
      logger: logger.error,
    }),
  )
