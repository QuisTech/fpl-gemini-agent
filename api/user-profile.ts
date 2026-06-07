import { getFirestore } from "../lib/firestore.js";
import type { Request, Response } from "express";

export default async function handler(req: Request, res: Response) {
  const { userId } = req.query as { userId?: string };
  
  if (!userId) {
    return res.status(400).json({ error: "Missing userId" });
  }

  const db = getFirestore();

  try {
    if (req.method === 'GET') {
      // Fetch profile
      const profile = await db.collection('user_profiles').doc(userId).get();
      if (!profile.exists) {
        return res.status(404).json({ error: "Profile not found" });
      }
      return res.json(profile.data());
    }
    
    if (req.method === 'PUT') {
      // Update profile
      const updates = req.body;
      await db.collection('user_profiles').doc(userId).set(updates, { merge: true });
      return res.json({ success: true });
    }
    
    if (req.method === 'DELETE') {
      // Soft delete (anonymize data)
      await db.collection('user_profiles').doc(userId).update({
        deletedAt: new Date(),
        email: `deleted_${userId}@removed.com`,
        displayName: 'Deleted User'
      });
      return res.json({ success: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (error: any) {
    console.error("Profile API Error:", error);
    return res.status(500).json({ error: error.message });
  }
}
