// ================================================================
// Edge Function: manage-users
// Gestione utenti riservata agli admin (list / create / update / delete).
// Usa la SERVICE_ROLE_KEY (iniettata automaticamente da Supabase),
// che NON è mai esposta al client.
// ================================================================
import { createClient } from 'jsr:@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // 1) Verifica che il chiamante sia un admin
    const authHeader = req.headers.get('Authorization') ?? '';
    const caller = createClient(url, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: uErr } = await caller.auth.getUser();
    if (uErr || !user) return json({ error: 'Non autenticato' }, 401);

    const { data: prof } = await caller.from('profiles').select('role').eq('id', user.id).single();
    if (prof?.role !== 'admin') return json({ error: 'Operazione riservata agli amministratori' }, 403);

    // 2) Esegui l'azione con i privilegi di servizio
    const admin = createClient(url, serviceKey);
    const body = await req.json().catch(() => ({}));
    const action = body.action || 'list';

    if (action === 'list') {
      const { data: { users } } = await admin.auth.admin.listUsers();
      const { data: profiles } = await admin.from('profiles').select('id,name,role,avatar');
      const pmap: Record<string, any> = Object.fromEntries((profiles || []).map((p: any) => [p.id, p]));
      const list = (users || []).map((u: any) => ({
        id: u.id,
        email: u.email,
        name: pmap[u.id]?.name || u.user_metadata?.name || u.email,
        role: pmap[u.id]?.role || u.user_metadata?.role || 'operator',
        avatar: pmap[u.id]?.avatar || u.user_metadata?.avatar || (u.email || '').slice(0, 2).toUpperCase(),
      }));
      return json({ ok: true, users: list });
    }

    if (action === 'create') {
      const { name, email, password, role, avatar } = body;
      if (!email || !password) return json({ error: 'Email e password obbligatorie' }, 400);
      const { data, error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true,
        user_metadata: { name, role: role || 'operator', avatar },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true, id: data.user.id });
    }

    if (action === 'update') {
      const { id, name, email, password, role, avatar } = body;
      if (!id) return json({ error: 'ID mancante' }, 400);
      const upd: any = { user_metadata: { name, role, avatar } };
      if (email) upd.email = email;
      if (password) upd.password = password;
      const { error } = await admin.auth.admin.updateUserById(id, upd);
      if (error) return json({ error: error.message }, 400);
      await admin.from('profiles').update({ name, role, avatar }).eq('id', id);
      return json({ ok: true });
    }

    if (action === 'delete') {
      const { id } = body;
      if (!id) return json({ error: 'ID mancante' }, 400);
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) return json({ error: error.message }, 400);
      return json({ ok: true });
    }

    return json({ error: 'Azione non valida' }, 400);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
