// This function runs on Netlify's servers, not in the visitor's browser.
// That's what keeps your Strava Client Secret and refresh token hidden from anyone
// viewing your website's page source.
//
// It does two things:
// 1. Uses your refresh token to get a fresh, short-lived access token from Strava
//    (access tokens expire every 6 hours, so this happens automatically, every time
//    the dashboard loads, rather than manually like we did in Terminal).
// 2. Uses that access token to fetch your recent activities from Strava, then hands
//    back only the fields the dashboard actually needs.

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
      id: a.id,
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

    // Step 3: pull a richer detail view + heart rate zones for the 2 most
    // recent activities only (keeps API usage low — we don't do this for
    // all 30, just the ones the dashboard highlights).
    const activityDetails = {};
    const idsToDetail = trimmed.slice(0, 2).map((a) => a.id);

    for (const id of idsToDetail) {
      const [detailRes, zonesRes] = await Promise.all([
        fetch(`https://www.strava.com/api/v3/activities/${id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        fetch(`https://www.strava.com/api/v3/activities/${id}/zones`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
      ]);

      const detail = detailRes.ok ? await detailRes.json() : null;
      const zones = zonesRes.ok ? await zonesRes.json() : [];
      const hrZoneBlock = zones.find((z) => z.type === "heartrate");

      activityDetails[id] = {
        id,
        calories: detail && detail.calories ? Math.round(detail.calories) : null,
        elev_high_m: detail && detail.elev_high != null ? Math.round(detail.elev_high) : null,
        elev_low_m: detail && detail.elev_low != null ? Math.round(detail.elev_low) : null,
        average_cadence: detail && detail.average_cadence ? Math.round(detail.average_cadence) : null,
        weighted_average_watts: detail && detail.weighted_average_watts ? Math.round(detail.weighted_average_watts) : null,
        suffer_score: detail && detail.suffer_score ? detail.suffer_score : null,
        kudos_count: detail && detail.kudos_count != null ? detail.kudos_count : null,
        splits: detail && detail.splits_metric
          ? detail.splits_metric.map((s) => ({
              split: s.split,
              distance_km: +(s.distance / 1000).toFixed(2),
              moving_time_min: +(s.moving_time / 60).toFixed(2),
              elevation_diff_m: Math.round(s.elevation_difference || 0),
              average_heartrate: s.average_heartrate || null,
              pace_min_per_km: s.moving_time && s.distance ? +((s.moving_time / (s.distance / 1000)) / 60).toFixed(2) : null,
            }))
          : [],
        hr_zones: hrZoneBlock
          ? hrZoneBlock.distribution_buckets.map((b, i) => ({
              zone: i + 1,
              min: b.min,
              max: b.max,
              minutes: +(b.time / 60).toFixed(1),
            }))
          : [],
      };
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        // cache for 10 minutes so we're not hammering Strava's API on every page view
        "Cache-Control": "public, max-age=600",
      },
      body: JSON.stringify({ activities: trimmed, activityDetails }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Unexpected error", details: err.message }),
    };
  }
};
