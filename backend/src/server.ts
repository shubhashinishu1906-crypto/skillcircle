import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import mongoose, { Schema } from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import { getFirebaseAdminAuth } from "./firebase-admin.js";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });

const app = express();
const port = Number(process.env.PORT || 4000);
const frontendDirectory = process.env.FRONTEND_DIR || path.resolve(process.cwd(), "../frontend");

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "8mb" }));
app.use(express.static(frontendDirectory, { setHeaders: (res) => res.setHeader("Cache-Control", "no-store") }));

const profileSchema = new Schema({ uid: { type: String, required: true, unique: true }, email: { type: String, required: true }, name: { type: String, default: "Student" }, photoUrl: String, bio: { type: String, default: "" }, college: { type: String, default: "" }, degree: { type: String, default: "" }, skills: [String], interests: [String], projects: [String], connections: { type: Number, default: 0 } }, { timestamps: true });
const postSchema = new Schema({ authorUid: { type: String, required: true }, text: { type: String, required: true, maxlength: 5000 }, imageUrl: String, likes: { type: [String], default: [] }, comments: [{ uid: String, text: String }] }, { timestamps: true });
const connectionSchema = new Schema({ requesterUid: String, recipientUid: String, status: { type: String, enum: ["pending", "accepted", "rejected"], default: "pending" } }, { timestamps: true });
const notificationSchema = new Schema({ recipientUid: String, actorUid: String, type: String, message: String, read: { type: Boolean, default: false } }, { timestamps: true });
const Profile = mongoose.models.Profile || mongoose.model("Profile", profileSchema);
const Post = mongoose.models.Post || mongoose.model("Post", postSchema);
const Connection = mongoose.models.Connection || mongoose.model("Connection", connectionSchema);
const Notification = mongoose.models.Notification || mongoose.model("Notification", notificationSchema);

type AuthedRequest = Request & { uid?: string; email?: string; name?: string; photoUrl?: string };
async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : "";
  if (!token) { res.status(401).json({ error: "Authentication required." }); return; }
  try { const decoded = await getFirebaseAdminAuth().verifyIdToken(token); req.uid = decoded.uid; req.email = decoded.email || ""; req.name = decoded.name || "Student"; req.photoUrl = decoded.picture; next(); }
  catch { res.status(401).json({ error: "Invalid or expired Firebase ID token." }); }
}
function ensureDatabase(res: Response) { if (mongoose.connection.readyState !== 1) { res.status(503).json({ error: "MongoDB is not connected. Set MONGODB_URI in the shared .env file." }); return false; } return true; }
async function profileFor(uid: string, data?: Partial<{ email: string; name: string; photoUrl: string }>) { return Profile.findOneAndUpdate({ uid }, { $setOnInsert: { uid, email: data?.email || "", name: data?.name || "Student", photoUrl: data?.photoUrl } }, { upsert: true, new: true }); }

app.post("/auth/verify", async (req, res) => {
  const token = typeof req.body?.token === "string" ? req.body.token : "";

  if (!token) {
    res.status(400).json({ error: "A Firebase ID token is required." });
    return;
  }

  try {
    const decodedToken = await getFirebaseAdminAuth().verifyIdToken(token);
    res.json({ uid: decodedToken.uid, email: decodedToken.email ?? null });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Missing Firebase Admin credentials")) {
      res.status(503).json({ error: "Firebase Admin is not configured on the backend." });
      return;
    }

    res.status(401).json({ error: "Invalid or expired Firebase ID token." });
  }
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "SkillCircle API",
    timestamp: new Date().toISOString(),
  });
});

app.get("/config", (_req, res) => res.json({ apiKey: process.env.FIREBASE_API_KEY, authDomain: process.env.FIREBASE_AUTH_DOMAIN, projectId: process.env.FIREBASE_PROJECT_ID, storageBucket: process.env.FIREBASE_STORAGE_BUCKET, messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID, appId: process.env.FIREBASE_APP_ID }));

app.get("/", (_req, res) => {
  res.json({
    message: "SkillCircle backend is running.",
    version: "phase-1",
  });
});

app.get("/api/me", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  res.json(await profileFor(req.uid!, { email: req.email, name: req.name, photoUrl: req.photoUrl }));
});

app.put("/api/me", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  const fields = { name: req.body.name, bio: req.body.bio, college: req.body.college, degree: req.body.degree, skills: req.body.skills, interests: req.body.interests, projects: req.body.projects };
  res.json(await Profile.findOneAndUpdate({ uid: req.uid }, { $set: fields }, { new: true, upsert: true }));
});

app.get("/api/posts", requireAuth, async (_req, res) => {
  if (!ensureDatabase(res)) return;
  const posts = await Post.find().sort({ createdAt: -1 }).limit(50).lean();
  const authors = await Profile.find({ uid: { $in: posts.map((post) => post.authorUid) } }).lean();
  const authorByUid = new Map(authors.map((author) => [author.uid, author]));
  res.json(posts.map((post) => ({ ...post, author: authorByUid.get(post.authorUid) })));
});

app.post("/api/posts", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  if (typeof req.body.text !== "string" || !req.body.text.trim()) { res.status(400).json({ error: "Post text is required." }); return; }
  res.status(201).json(await Post.create({ authorUid: req.uid, text: req.body.text.trim(), imageUrl: req.body.imageUrl }));
});

app.post("/api/posts/:id/like", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  const post = await Post.findById(req.params.id);
  if (!post) { res.status(404).json({ error: "Post not found." }); return; }
  const hasLiked = post.likes.includes(req.uid!);
  post.likes = hasLiked ? post.likes.filter((uid: string) => uid !== req.uid) : [...post.likes, req.uid!];
  await post.save();
  if (!hasLiked && post.authorUid !== req.uid) await Notification.create({ recipientUid: post.authorUid, actorUid: req.uid, type: "like", message: `${req.name} liked your post.` });
  res.json(post);
});

app.post("/api/posts/:id/comments", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  const text = typeof req.body.text === "string" ? req.body.text.trim() : "";
  const post = await Post.findById(req.params.id);
  if (!post || !text) { res.status(400).json({ error: "A comment is required." }); return; }
  post.comments.push({ uid: req.uid, text } as never);
  await post.save();
  if (post.authorUid !== req.uid) await Notification.create({ recipientUid: post.authorUid, actorUid: req.uid, type: "comment", message: `${req.name} commented on your post.` });
  res.status(201).json(post);
});

app.get("/api/users", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  const search = String(req.query.search || "").trim();
  const regex = search ? new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") : /.*/;
  res.json(await Profile.find({ uid: { $ne: req.uid }, $or: [{ name: regex }, { college: regex }, { skills: regex }, { interests: regex }] }).limit(30).lean());
});

app.post("/api/connections", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  const recipient = await Profile.findOne({ email: req.body.email });
  if (!recipient || recipient.uid === req.uid) { res.status(400).json({ error: "That student is not available." }); return; }
  const existing = await Connection.findOne({ $or: [{ requesterUid: req.uid, recipientUid: recipient.uid }, { requesterUid: recipient.uid, recipientUid: req.uid }] });
  if (existing) { res.status(409).json({ error: "You already have a connection request with this student." }); return; }
  const connection = await Connection.create({ requesterUid: req.uid, recipientUid: recipient.uid });
  await Notification.create({ recipientUid: recipient.uid, actorUid: req.uid, type: "connection", message: `${req.name} sent you a connection request.` });
  res.status(201).json(connection);
});

app.patch("/api/connections/:id", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  const connection = await Connection.findById(req.params.id);
  if (!connection || (connection.requesterUid !== req.uid && connection.recipientUid !== req.uid)) { res.status(404).json({ error: "Connection request not found." }); return; }
  const nextStatus = req.body.status;
  if (!["accepted", "rejected"].includes(nextStatus)) { res.status(400).json({ error: "Connection status is invalid." }); return; }
  connection.status = nextStatus;
  await connection.save();
  if (nextStatus === "accepted") {
    await Promise.all([Profile.updateMany({ uid: { $in: [connection.requesterUid, connection.recipientUid] } }, { $inc: { connections: 1 } }), Notification.create({ recipientUid: connection.requesterUid, actorUid: req.uid, type: "accepted", message: `${req.name} accepted your connection request.` })]);
  }
  res.json(connection);
});

app.delete("/api/connections/:id", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  const result = await Connection.deleteOne({ _id: req.params.id, $or: [{ requesterUid: req.uid }, { recipientUid: req.uid }] });
  if (!result.deletedCount) { res.status(404).json({ error: "Connection not found." }); return; }
  res.status(204).end();
});

app.get("/api/notifications", requireAuth, async (req: AuthedRequest, res) => {
  if (!ensureDatabase(res)) return;
  res.json(await Notification.find({ recipientUid: req.uid }).sort({ createdAt: -1 }).limit(50).lean());
});

app.post("/api/ai/bio", requireAuth, async (req, res) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) { res.status(503).json({ error: "GROQ_API_KEY is not configured." }); return; }
  const prompt = `Write a concise, professional student networking bio using college ${req.body.college || ""}, skills ${req.body.skills || ""}, interests ${req.body.interests || ""}, projects ${req.body.projects || ""}. Return only the bio.`;
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.GROQ_MODEL || "llama-3.1-8b-instant", messages: [{ role: "user", content: prompt }], temperature: 0.7 }) });
  if (!response.ok) { res.status(502).json({ error: "Groq could not generate a bio." }); return; }
  const data = await response.json() as { choices?: { message?: { content?: string } }[] };
  res.json({ bio: data.choices?.[0]?.message?.content || "" });
});

app.post("/api/uploads", requireAuth, async (req, res) => {
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) { res.status(503).json({ error: "Cloudinary is not configured." }); return; }
  cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
  try { const result = await cloudinary.uploader.upload(req.body.data, { folder: "skillcircle" }); res.json({ url: result.secure_url }); }
  catch { res.status(502).json({ error: "Image upload failed." }); }
});

mongoose.connect(process.env.MONGODB_URI || "").then(() => console.log("SkillCircle MongoDB connected")).catch(() => console.warn("MongoDB is not connected; API persistence is unavailable."));

app.listen(port, () => {
  console.log(`SkillCircle backend listening on http://localhost:${port}`);
});
