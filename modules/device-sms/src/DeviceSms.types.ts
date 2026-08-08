export type SmsEncoding = 'gsm7' | 'ucs2' | '8bit' | 'unknown';

export type SegmentCount = {
  /** Messages the network will actually be charged for. */
  segments: number;
  /** Code units consumed by the body so far. */
  used: number;
  /** Code units left in the current segment. */
  remaining: number;
  /**
   * `gsm7` gives 160 characters per segment, `ucs2` only 70. A single Turkmen
   * ä, ň, ö, ü, ý or ž drops the whole message to `ucs2`.
   */
  encoding: SmsEncoding;
};

export type PermissionResponse = {
  status: 'granted' | 'denied' | 'undetermined';
  granted: boolean;
  canAskAgain: boolean;
  expires: 'never' | number;
};

export type SendResult = {
  id: string;
  /** How many segments the message was split into. */
  parts: number;
};

/**
 * What the network said about a message that had already left the phone.
 *
 * `reason` is `rejected` when the report carries a permanent error status —
 * a disconnected number, a barred handset — and `not_delivered` when the report
 * only says no. No event at all means no report arrived, which is not the same
 * as a failure: plenty of networks never send one.
 */
export type DeliveryReport = {
  /** The `id` the message was sent with. */
  id: string;
  delivered: boolean;
  reason: 'rejected' | 'not_delivered' | null;
};

export type DeviceSmsModuleType = {
  /** False on a device with no telephony radio. */
  isAvailable(): boolean;
  hasPermission(): boolean;
  getPermissionsAsync(): Promise<PermissionResponse>;
  requestPermissionsAsync(): Promise<PermissionResponse>;
  countSegments(body: string): SegmentCount;
  /**
   * Resolves once every segment has been accepted by the network. Rejects with
   * a `CodedException` whose message is one of the reasons in `describeResult`
   * — `no_service`, `radio_off`, `limit_exceeded`, `timeout` and so on.
   */
  sendAsync(id: string, phone: string, body: string): Promise<SendResult>;
  /**
   * Settle every send still waiting on a broadcast, rejecting each with
   * `cancelled`. Returns how many there were. Nothing is unsent — this only
   * stops the app waiting.
   */
  cancelAll(): number;
  addListener(event: 'onSmsDelivery', listener: (report: DeliveryReport) => void): {
    remove(): void;
  };
};
