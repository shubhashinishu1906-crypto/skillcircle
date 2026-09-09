import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import dotenv from "dotenv";
import path from "node:path";
import { existsSync } from "node:fs";

const envFile = process.env.ENV_FILE || (existsSync(path.resolve(process.cwd(), "../.env"))
  ? path.resolve(process.cwd(), "../.env")
  : path.resolve(process.cwd(), ".env"));
dotenv.config({ path: envFile });

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

export function getFirebaseAdminAuth() {
  if (!serviceAccountJson && (!projectId || !clientEmail || !privateKey) && !credentialsFile) {
    throw new Error(
      "Missing Firebase Admin credentials. Set FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY.",
    );
  }

  let serviceAccount: { projectId?: string; clientEmail?: string; privateKey?: string } | undefined;
  if (serviceAccountJson) {
    try {
      serviceAccount = JSON.parse(serviceAccountJson) as typeof serviceAccount;
    } catch {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.");
    }
  }

  const app = getApps()[0] ?? initializeApp({
    credential: credentialsFile
      ? applicationDefault()
      : cert(serviceAccount || { projectId, clientEmail, privateKey }),
  });
  return getAuth(app);
}