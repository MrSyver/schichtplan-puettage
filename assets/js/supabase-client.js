// Zentraler Supabase-Client. Wird von public.js und admin.js importiert.
// Laedt supabase-js per ESM-CDN – kein npm-Build noetig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.startsWith('https://xxxx')) {
    console.warn(
        '[Puettage-Helferplan] config.js fehlt oder ist noch nicht ausgefuellt. ' +
        'Kopiere config.example.js nach config.js und trage die Supabase-Zugangsdaten ein.'
    );
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
    },
});
