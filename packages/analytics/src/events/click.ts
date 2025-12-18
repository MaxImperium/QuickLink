/**
 * Click Event Type Definition
 */

export interface ClickEvent {
  id: string;
  linkId: string;
  timestamp: Date;
  metadata: ClickMetadata;
}

export interface ClickMetadata {
  ipHash?: string;
  userAgent?: string;
  referer?: string;
  country?: string;
  city?: string;
}
