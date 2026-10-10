// Trusted Member is a moderator-managed status; contribution points are recognition.
export const approvedContributionCount = `(SELECT COUNT(*) FROM contributions c WHERE c.user_id=m.id AND c.status='accepted' AND c.reviewed_at IS NOT NULL AND c.reviewed_by IS NOT NULL AND c.reviewed_by<>c.user_id AND c.kind IN ('comment','submission','flag'))`;
export async function canPublishDirectly(db,userId){
 const row=await db.prepare('SELECT trusted FROM members WHERE id=?').bind(userId).first();
 return row?.trusted===1;
}
