import { Alert } from "./types"

export class Convert {
  static alertToJson(alert: Alert): string {
    return JSON.stringify(alert, null, 2) // Pretty-print the JSON with 2 spaces
  }
}
