export async function canPublishDirectly(db,userId){
 const row=await db.prepare('SELECT COALESCE(SUM(amount),0) total FROM reputation_events WHERE user_id=?').bind(userId).first();
 return Number(row?.total||0)>15;
}
