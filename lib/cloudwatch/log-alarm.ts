import { Construct } from "constructs"
import { IVpc, SubnetType } from "aws-cdk-lib/aws-ec2"
import { Duration, Fn, RemovalPolicy, Stack } from "aws-cdk-lib"
import {
  Alarm,
  ComparisonOperator,
  CreateAlarmOptions,
  MetricOptions,
} from "aws-cdk-lib/aws-cloudwatch"
import { Queue } from "aws-cdk-lib/aws-sqs"
import { Rule } from "aws-cdk-lib/aws-events"
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets"
import { Key } from "aws-cdk-lib/aws-kms"
import { Runtime } from "aws-cdk-lib/aws-lambda"
import {
  IFilterPattern,
  LogGroup,
  ILogGroup,
  MetricFilter,
  RetentionDays,
} from "aws-cdk-lib/aws-logs"
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs"
import { Environment, Priority, Recipients } from "./types"

/** What to emit when the alarm is triggered. */
export interface LogAlertDetails {
  /**
   * Used in the title of the mattermost message e.g. "Detected 1 error(s) in some-log-group"
   *
   * @default none
   */
  readonly title: string
  /** @see {@link Priority} */
  readonly priority: Priority
  /**
   * The recipients to send the message to.
   * Must contain at least one Recipient.
   *
   */
  readonly recipients: Recipients
  /**
   * Additional details to add to the event
   *
   * @default none
   */
  readonly details?: Record<string, string>
  /** The property in the log event to use as the error message. Will be truncated to 2.000 characters for mattermost compatibility.
   *
   * Supported formats are dot delimited JSON path or simple string property name.
   * @example
   * `errorMessageProperty: "error.message"`
   * supports both
   * ```
   * {
   *   "error": {
   *     "message": "something bad happened"
   *   }
   * }
   * ```
   * and
   * ```
   * {
   *   "error.message": "something bad happened"
   * }
   * ```
   */
  readonly errorMessageProperty: string
  /** The property in the log event to use as the stack trace. Will be truncated to 15.000 characters for mattermost compatibility.
   *
   * Supported formats are dot delimited JSON path or simple string property name.
   * @example
   * `stackTraceProperty: "error.stack_trace"`
   * supports both
   * ```
   * {
   *   "error": {
   *     "stack_trace": "something bad happened"
   *   }
   * }
   * ```
   * and
   * ```
   * {
   *   "error.stack_trace": "something bad happened"
   * }
   * ```
   */
  readonly stackTraceProperty: string
}

export interface LogAlarmProps {
  /**
   * Description for the alarm
   *
   * @default none
   * @optional
   */
  readonly description?: string
  /**
   * @default Environment.Prod
   * @see {@link Environment}
   */
  readonly environment?: Environment
  /**
   * The filter pattern used to trigger the alarm
   *
   * @see {@link IFilterPattern}
   */
  readonly filterPattern: IFilterPattern
  /**
   * The log group to monitor.
   * This is the log group used to trigger the alarm.
   *
   * @see {@link ILogGroup}
   */
  readonly logGroup: ILogGroup
  /**
   * The log group the Publisher Lambda function will to use to send its logs to.
   * Optional, if not provided a new log group with retention 1 month will be created.
   * For instance, if one has many log-alarms one might want to send all the Publisher logs
   * to a single log group.
   *
   * @see {@link ILogGroup}
   * @optional
   */
  readonly publisherLogGroup?: ILogGroup
  /** @see {@link AlertDetails} */
  readonly alertDetails: LogAlertDetails
  /**
   * Which VPC the lambda this construct creates should be put in. It will use the PRIVATE_ISOLATED
   * subnet.
   */
  readonly vpc: IVpc

  /**
   * Custom optional field to override default props in an alarm.
   *
   * @see {@link CreateAlarmOptions}
   */
  readonly alarmProps?: CreateAlarmOptions

  /**
   * Custom optional field to override default props in a Metric.
   *
   * @see {@link MetricOptions}
   */
  readonly metricProps?: MetricOptions
}

/**
 * This construct creates a log alarm that triggers a mattermost message when a filter pattern is
 * matched.
 *
 *
 *
 * @example
 *   import { LogAlarm } from "op-cdk"
 *
 *   new LogAlarm(stack, "ErrorLogAlarm", {
 *     description: "Error log alarm for TestLogGroup",
 *     environment: Environment.Itest,
 *     alertDetails: {
 *       title: "Detected 1 error in: TestLogGroup",
 *       priority: Priority.P2,
 *       recipients: { mattermostChannelNames: ["error-log-alert-channel"] },
 *       errorMessageProperty: "message",
 *       stackTraceProperty: "thrown.message",
 *     },
 *     filterPattern: FilterPattern.stringValue("$.['level']", "=", "ERROR"),
 *     logGroup: new LogGroup(stack, "TestLogGroup", {
 *       logGroupName: "TestLogGroup",
 *     }),
 *     vpc: vpc,
 *     alarmProps: CreateAlarmOptions = {
 *       comparisonOperator: ComparisonOperator.LESS_THAN_THRESHOLD,
 *       datapointsToAlarm: 1,
 *       evaluationPeriods: 10,
 *       threshold: 5,
 *     },
 *     metricProps: MetricOptions = {
 *       period: Duration.minutes(10)
 *     }
 *   })
 */
export class LogAlarm extends Construct {
  readonly alarm: Alarm

  constructor(scope: Construct, id: string, props: LogAlarmProps) {
    super(scope, id)
    if (
      !(
        props.alertDetails.recipients?.opsgenieTeams &&
        props.alertDetails.recipients.opsgenieTeams.length
      ) &&
      !(
        props.alertDetails.recipients?.jiraTeamIds &&
        props.alertDetails.recipients.jiraTeamIds.length
      ) &&
      !(
        props.alertDetails.recipients?.mattermostChannelNames &&
        props.alertDetails.recipients.mattermostChannelNames.length
      )
    ) {
      throw new Error("Must have at least one Recipient")
    }

    const errorLogFilter = new MetricFilter(this, "LogFilter", {
      logGroup: props.logGroup,
      metricNamespace: props.logGroup.logGroupName,
      metricName: "LogFilter",
      filterPattern: props.filterPattern,
      metricValue: "1",
    })

    const metric = errorLogFilter.metric(props.metricProps)
    this.alarm = new Alarm(this, "LogAlarm", {
      alarmDescription: props.description,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      threshold: 0,
      evaluationPeriods: 1,
      metric: metric,
      ...props.alarmProps,
    })

    const queueAccount = props.environment ?? Environment.Prod

    const queueName = "TestQueueName"
    const region = Stack.of(this).region

    const notificationQueueArn = `arn:aws:sqs:${region}:${queueAccount}:${queueName}`

    const notificationQueueKeyId = "1064f6db-34e1-46bd-8ce2-33b1d00a8f1a"
    const notificationQueueKeyArn = `arn:aws:kms:${
      region
    }:${queueAccount}:key/${notificationQueueKeyId}`

    const environment: Record<string, string> = {}

    environment.TITLE = props.alertDetails.title
    environment.ERROR_MESSAGE_PROPERTY = props.alertDetails.errorMessageProperty
    environment.STACK_TRACE_PROPERTY = props.alertDetails.stackTraceProperty

    environment.FILTER_PATTERN = props.filterPattern.logPatternString
    environment.LOG_GROUP_NAME = props.logGroup.logGroupName

    environment.LOG_LEVEL = "INFO"
    environment.QUEUE_NAME = queueName
    environment.QUEUE_ACCOUNT = queueAccount
    environment.PRIORITY = props.alertDetails.priority
    environment.SOURCE = props.logGroup.logGroupName
    environment.PERIOD = `${metric.period.toMinutes()}`

    environment.RECIPIENTS = JSON.stringify(props.alertDetails.recipients)

    const encryptionKey = Key.fromKeyArn(
      this,
      "EncryptionKey",
      Fn.importValue("your:Key"),
    )
    const publisherLogGroup =
      props.publisherLogGroup ||
      new LogGroup(this, "PublisherLogGroup", {
        retention: RetentionDays.ONE_MONTH,
        encryptionKey,
        removalPolicy: RemovalPolicy.DESTROY,
      })

    const publisher = new NodejsFunction(this, "Publisher", {
      environment: environment,
      logGroup: publisherLogGroup,
      runtime: Runtime.NODEJS_18_X,
      timeout: Duration.minutes(2),
      vpc: props.vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_ISOLATED },
    })

    props.logGroup.grantRead(publisher)

    const queue = Queue.fromQueueArn(
      this,
      "NotificationQueue",
      notificationQueueArn,
    )
    const notificationQueueKey = Key.fromKeyArn(
      this,
      "NotificationQueueKey",
      notificationQueueKeyArn,
    )

    queue.grantSendMessages(publisher)
    notificationQueueKey.grantEncryptDecrypt(publisher)

    new Rule(this, "LogAlarmPublisherRule", {
      description:
        "Rule making sure that alarms is sent to recipients via sqs queue.",
      eventPattern: {
        source: ["aws.cloudwatch"],
        detailType: ["CloudWatch Alarm State Change"],
        resources: [this.alarm.alarmArn],
        detail: {
          state: {
            value: ["ALARM"],
          },
        },
      },
      targets: [new LambdaFunction(publisher)],
    })
  }
}
