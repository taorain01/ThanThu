// Kiểm tra RLS bảng bc_users — output rõ ràng hơn
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

const SUPABASE_URL = 'https://wwrzjsgqmxwhjnqhphph.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cnpqc2dxbXh3aGpucWhwaHBoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ5MzAxMjgsImV4cCI6MjA5MDUwNjEyOH0.F4BARXdexWqEWOplG6NigJK5Twti9VZY2VwTqhR4dK0';

async function main() {
    // Đọc service key từ .env
    const envContent = fs.readFileSync('.env', 'utf8');
    const serviceMatch = envContent.match(/SUPABASE_SERVICE_KEY=(.+)/);
    
    if (!serviceMatch) {
        console.log('Khong tim thay SUPABASE_SERVICE_KEY trong .env');
        // Thử với anon key
        const sb = createClient(SUPABASE_URL, ANON_KEY);
        const r = await sb.from('bc_users').select('discord_id, username, lang_gia_member').limit(3);
        console.log('ANON result:', JSON.stringify(r, null, 2));
        return;
    }
    
    const SERVICE_KEY = serviceMatch[1].trim();
    const sb = createClient(SUPABASE_URL, SERVICE_KEY);
    
    // Tìm user Anyton/jayceme
    const { data, error } = await sb.from('bc_users')
        .select('discord_id, username, game_username, position, lang_gia_member')
        .or('username.ilike.%jayceme%,username.ilike.%anyton%,game_username.ilike.%anyton%');
    
    console.log('=== TIM USER ANYTON ===');
    if (error) console.log('Loi:', error.message);
    else console.log('Ket qua:', JSON.stringify(data, null, 2));
    
    // Thống kê
    const { data: all, count } = await sb.from('bc_users')
        .select('lang_gia_member', { count: 'exact' });
    const total = all?.length || 0;
    const trueC = all?.filter(u => u.lang_gia_member === true).length || 0;
    const falseC = all?.filter(u => u.lang_gia_member === false).length || 0;
    const nullC = all?.filter(u => u.lang_gia_member == null).length || 0;
    console.log(`\nThong ke: ${total} users | true=${trueC} | false=${falseC} | null=${nullC}`);
}

main().catch(e => console.error('FATAL:', e.message));
