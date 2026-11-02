export async function onRequestGet({env}){return Response.json({ok:true,functions:true,d1:!!env.DB})}
