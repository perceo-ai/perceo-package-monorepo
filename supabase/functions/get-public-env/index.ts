// GET public env key/values from public_env table (public = true only).
// No auth required; returns only non-secret config for CLI (e.g. PERCEO_SUPABASE_URL, PERCEO_SUPABASE_ANON_KEY).
// CORS enabled for CLI and browser callers.

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "jsr:@supabase/supabase-js@2/cors";

Deno.serve(async (req: Request) => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}

	if (req.method !== "GET") {
		return new Response(JSON.stringify({ error: "Method not allowed" }), {
			headers: { ...corsHeaders, "Content-Type": "application/json" },
			status: 405,
		});
	}

	try {
		const supabaseUrl = Deno.env.get("SUPABASE_URL");
		const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
		if (!supabaseUrl || !serviceRoleKey) {
			return new Response(JSON.stringify({ error: "Server configuration error" }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
		}

		const supabase = createClient(supabaseUrl, serviceRoleKey);
		const { data, error } = await supabase.from("public_env").select("key, value").eq("public", true);

		if (error) {
			return new Response(JSON.stringify({ error: error.message }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
		}

		const env: Record<string, string> = {};
		for (const row of data ?? []) {
			if (row.key != null && row.value != null) {
				env[String(row.key)] = String(row.value);
			}
		}

		return new Response(JSON.stringify(env), {
			headers: { ...corsHeaders, "Content-Type": "application/json" },
			status: 200,
		});
	} catch (err) {
		return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 });
	}
});
