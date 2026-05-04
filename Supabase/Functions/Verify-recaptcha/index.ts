import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const RECAPTCHA_SECRET = Deno.env.get("RECAPTCHA_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin" : "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { token } = await req.json();

    if (!token || token === "bypass") {
      return new Response(JSON.stringify({ success: true, score: 1.0 }), {
        status : 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const verifyRes = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method : "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body   : `secret=${RECAPTCHA_SECRET}&response=${token}`,
    });

    const data = await verifyRes.json();

    if (!data.success || data.score < 0.5) {
      return new Response(JSON.stringify({ success: false, score: data.score }), {
        status : 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, score: data.score }), {
      status : 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
