import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vfyynrzyadvigdomqlmk.supabase.co'  // あなたの Project URL
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZmeXlucnp5YWR2aWdkb21xbG1rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1Njc0MzUsImV4cCI6MjA5NTE0MzQzNX0.Gr3LtPqNrkUJRmBSW4-pGW54TcQKcHulcy-870qL_mo'                // あなたの anon public key

export const supabase = createClient(supabaseUrl, supabaseAnonKey)