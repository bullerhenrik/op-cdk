export interface Recipient {
  key: string
  value: string
}

export interface Recipients {
  opsgenieTeams?: string[]
  jiraTeamIds?: string[]
  mattermostChannelNames?: string[]
}

export interface AlertDetail {
  key: string
  value: string
}

export interface Alert {
  title: string
  description: string
  id: string
  priority: string
  recipients: Recipient[]
  source: string
  details: AlertDetail[]
  tags: string[]
}

export enum Environment {
  Prod = "123456789012", // Dummy AWS account number for production
  Test = "987654321098", // Dummy AWS account number for test
}

export enum Priority {
  P1 = "P1",
  P2 = "P2",
  P3 = "P3",
  P4 = "P4",
  P5 = "P5",
}

export interface CloudWatchAlarmEvent {
  account: string
  region: string
  alarmName: string
  state: {
    value: string
    reason: string
    timestamp: string
    reasonData?: string
  }
  previousState?: {
    value: string
    timestamp: string
    reason?: string
    reasonData?: string
  }
  trigger: {
    metricName: string
    namespace: string
    statisticType: string
    statistic: string
    unit?: string
    dimensions: { [key: string]: string }
    threshold: number
    comparisonOperator: string
    evaluationPeriods: number
  }
  configuration?: {
    description?: string
    metrics?: {
      id: string
    }[]
  }
}

export interface Detail {
  key: string
  value: string
}
