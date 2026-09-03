import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import dotenv from "dotenv";
import path from "node:path";
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const projectId = process.env.FIREBASE_PROJECT_ID;
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const credentialsFile = process.env.GOOGLE_APPLICATION_CREDENTIALS;

export function getFirebaseAdminAuth() {
  if ((!projectId || !clientEmail || !privateKey) && !credentialsFile) {
    throw new Error(
      "Missing Firebase Admin credentials. Set GOOGLE_APPLICATION_CREDENTIALS or the FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY variables.",
    );
  }

  const app = getApps()[0] ?? initializeApp({
    credential: credentialsFile ? applicationDefault() : cert({ projectId, clientEmail, privateKey }),
  });
  return getAuth(app);
}