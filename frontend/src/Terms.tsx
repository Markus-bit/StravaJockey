// Terms of Service + privacy notice. DRAFT: have it reviewed before relying on it.
const SITE = "StravaJockey";
const LAST_UPDATED = "November 15, 2026";

export default function TermsContent() {
  return (
    <div className="terms">
      <p className="terms-updated">Last updated: {LAST_UPDATED}</p>

      <h3>1. About these terms</h3>
      <p>
        By using {SITE} (“the service”) you agree to these terms. If you don't agree, please don't
        use it.
      </p>

      <h3>2. What the service does</h3>
      <p>
        {SITE} lets you draw a route on a map and generates a simulated GPS activity file (GPX) for it,
        with timestamps, elevation and optional heart rate data based on the settings you choose. The
        data in these files is generated. It is not a recording of a real activity.
      </p>

      <h3>3. Your responsibility</h3>
      <p>You decide what you do with the files you generate, and you are responsible for that. In particular:</p>
      <ul>
        <li>
          Uploading generated activities to fitness platforms such as Strava may break those platforms'
          terms and can lead to your account being restricted or closed. Read their terms before you upload.
        </li>
        <li>
          Don't use generated files to mislead others, for example in competitions, challenges,
          leaderboards, insurance or employer wellness programmes, or anything else where a real
          activity is expected.
        </li>
        <li>Only use the service in ways that are legal where you live.</li>
      </ul>

      <h3>4. No guarantees</h3>
      <p>
        The service is free and provided “as is”. We don't promise that it will always be available,
        that it is free of errors, or that generated files will be accepted or shown correctly by any
        other app or platform. Distances, elevation and other values are estimates.
      </p>

      <h3>5. Liability</h3>
      <p>
        As far as the law allows, we are not liable for losses that come from using the service or the
        files it generates, including the loss of an account on another platform. Nothing in these terms
        limits rights you have under mandatory consumer law.
      </p>

      <h3>6. Third-party services</h3>
      <p>
        The map, routing and elevation data are provided by Mapbox, using map data from
        OpenStreetMap contributors. If Mapbox elevation is unavailable, elevation comes from
        OpenTopoData instead. Their own terms apply to their services.
      </p>

      <h3>7. No affiliation</h3>
      <p>
        {SITE} is an independent project. It is not affiliated with, endorsed by or sponsored by Strava,
        Garmin or any other fitness platform. Their names and trademarks belong to their owners.
      </p>

      <h3>8. Privacy</h3>
      <p>We keep this simple and collect as little as possible:</p>
      <ul>
        <li>There are no user accounts and no cookies.</li>
        <li>
          We count visits with Vercel Web Analytics. It uses no cookies and stores no IP addresses or
          other identifiers that could track you across sites; visits are only recognised for 24 hours
          by an anonymous hash. We see aggregated statistics only: which page was opened, the referring
          site, approximate location (country/city), browser, operating system and device type.
        </li>
        <li>
          We also keep our own daily totals of how the site is used: for example how many routes were
          snapped and files downloaded, run or bike, the route length and pace in broad ranges, the
          hour of the day, the type of device (mobile, tablet or desktop), the country (from the
          request, not stored with anything else) and the kind of site that linked here (for example
          "Google"). These are only counted as totals per day; nothing that identifies you or your
          device is stored.
        </li>
        <li>
          The points you click and the route generated from them are sent to our server to build the
          route and the file. To do that, the server sends the route coordinates to Mapbox (routing
          and elevation), or to OpenTopoData if Mapbox elevation is unavailable. We don't save routes
          or files; routes and elevation data may be kept in memory for a short time to avoid repeated
          lookups, and are lost when the server restarts.
        </li>
        <li>
          Your activity name, pace and heart rate settings are only used to build the file and are
          not stored.
        </li>
        <li>
          The “locate me” button uses your device's location only in your browser to move the map. It is
          not sent to our server.
        </li>
        <li>
          When the map loads, your browser fetches map tiles directly from Mapbox, which receives your IP
          address and usage data as described in Mapbox's privacy policy.
        </li>
      </ul>

      <h3>9. Changes</h3>
      <p>
        We may update these terms. The date at the top shows when they last changed. Continuing to use
        the service after a change means you accept the new terms.
      </p>
    </div>
  );
}
