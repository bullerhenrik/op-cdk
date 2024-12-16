import * as cdk from "aws-cdk-lib"
import { Construct } from "constructs"
import { FilterPattern, LogGroup } from "aws-cdk-lib/aws-logs"
import { LogAlarm } from "./cloudwatch/log-alarm"
import { Priority } from "./cloudwatch/types"
import { Vpc } from "aws-cdk-lib/aws-ec2"

export class OpCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props)

    const vpc = Vpc.fromLookup(this, "Vpc", { vpcName: "op-cdk-vpc" })

    const logGroup = new LogGroup(this, "LogGroup", {
      logGroupName: "op-cdk-log-group",
    })

    new LogAlarm(this, "ErrorLogAlarm", {
      description: "Error log alarm for LogGroup",
      alertDetails: {
        title: "Detected 1 error in: LogGroup",
        priority: Priority.P1,
        errorMessageProperty: "message",
        stackTraceProperty: "thrown.message",
        recipients: { mattermostChannelNames: ["op-cdk-errors"] },
      },
      filterPattern: FilterPattern.stringValue("$.['log.level']", "=", "ERROR"),
      logGroup: logGroup,
      vpc: vpc,
    })
  }
}
