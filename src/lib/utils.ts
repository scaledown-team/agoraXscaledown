/**
 * Generate a random channel name for the Agora conversation
 */
export function generateChannelName(): string {
  return `channel_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Generate a random UID for the user
 */
export function generateUid(): number {
  return Math.floor(Math.random() * 100000) + 1;
}

/**
 * Base64 encode credentials for Agora REST API Basic Auth
 * Uses AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET (from Agora Console > RESTful API)
 */
export function getAgoraAuthHeader(): string {
  const customerId = process.env.AGORA_CUSTOMER_ID;
  const customerSecret = process.env.AGORA_CUSTOMER_SECRET;
  if (!customerId || !customerSecret) {
    throw new Error(
      "AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET are required. " +
      "Get these from Agora Console > RESTful API."
    );
  }
  const credentials = Buffer.from(`${customerId}:${customerSecret}`).toString("base64");
  return `Basic ${credentials}`;
}
