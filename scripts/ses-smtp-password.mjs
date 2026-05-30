#!/usr/bin/env node
import crypto from "node:crypto";

const secret = process.argv[2];
const region = process.argv[3] || "us-east-1";

if (!secret) {
  console.error("Usage: node scripts/ses-smtp-password.mjs <aws-secret-access-key> [region]");
  process.exit(1);
}

function hmac(key, message) {
  return crypto.createHmac("sha256", key).update(message, "utf8").digest();
}

let key = hmac(Buffer.from(`AWS4${secret}`, "utf8"), "11111111");
key = hmac(key, region);
key = hmac(key, "ses");
key = hmac(key, "aws4_request");
key = hmac(key, "SendRawEmail");

console.log(Buffer.concat([Buffer.from([0x04]), key]).toString("base64"));
