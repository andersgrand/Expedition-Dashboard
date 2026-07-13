 
exports.handler = async function (event, context) {
  try {
    const CLIENT_ID = process.env.STRAVA_CLIENT_ID;
    const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
    const REFRESH_TOKEN = process.env.STRAVA_REFRESH_TOKEN;
 
    if (!CLIENT_ID || !CLIENT_SECRET || !REFRESH_TOKEN) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error:
            "Missing Strava credentials. Set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and STRAVA_REFRESH_TOKEN in Netlify's Environment Variables.",
        }),
      };
    }
 
    // Step 1: refresh the access token
    const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: REFRESH_TOKEN,
        grant_type: "refresh_token",
      }),
    });
 
    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Strava token refresh failed", details: errText }),
      };
    }
 
    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;
 
    // Step 2: fetch recent activities (last 30, most recent first)
    const activitiesResponse = await fetch(
      "https://www.strava.com/api/v3/athlete/activities?per_page=30",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      }
    );
 
    if (!activitiesResponse.ok) {
      const errText = await activitiesResponse.text();
      return {
        statusCode: 502,
        body: JSON.stringify({ error: "Strava activities fetch failed", details: errText }),
      };
    }
 
    const activities = await activitiesResponse.json();
 
    // Only send the dashboard what it needs, trimmed down and cleanly named
    const trimmed = activities.map((a) => ({
      name: a.name,
      date: a.start_date_local,
      distance_km: +(a.distance / 1000).toFixed(1),
      elevation_gain_m: Math.round(a.total_elevation_gain),
      moving_time_min: Math.round(a.moving_time / 60),
      average_heartrate: a.average_heartrate || null,
      max_heartrate: a.max_heartrate || null,
      average_speed_kmh: +(a.average_speed * 3.6).toFixed(1),
      polyline: a.map ? a.map.summary_polyline : null,
      start_lat: a.start_latlng ? a.start_latlng[0] : null,
      start_lng: a.start_latlng ? a.start_latlng[1] : null,
      end_lat: a.end_latlng ? a.end_latlng[0] : null,
      end_lng: a.end_latlng ? a.end_latlng[1] : null,
    }));
 
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // cache for 10 minutes so we're not hammering Strava's API on every page view
        "Cache-Control": "public, max-age=600",
      },
      body: JSON.stringify({ activities: trimmed }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error", details: err.message }),
    };
  }
};
 
