// Terms of Service + privacy notice. DRAFT: have it reviewed before relying on it.
// Fill in the operator and contact details below; they are shown in the text.
const SITE = "StravaJockey";
const OPERATOR = "[your name or company]";
const CONTACT_EMAIL = "[your contact email]";
const LAST_UPDATED = "November 11, 2026";

export default function TermsContent() {
  return (
    <div className="terms">
      <p className="terms-updated">Last updated: {LAST_UPDATED}</p>

      <h3>1. About these terms</h3>
      <p>
        {SITE} (“the service”) is run by {OPERATOR}. By using the service you agree to these terms.
        If you don't agree, please don't use it.
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
        <li>There are no user accounts, no cookies and no analytics or tracking.</li>
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
      <p>
        If you have questions about your data, contact us at {CONTACT_EMAIL}. You also have the right
        to complain to your data protection authority (in Norway: Datatilsynet).
      </p>

      <h3>9. Changes</h3>
      <p>
        We may update these terms. The date at the top shows when they last changed. Continuing to use
        the service after a change means you accept the new terms.
      </p>

      <h3>10. Law and contact</h3>
      <p>
        These terms are governed by Norwegian law. Questions about the service or these terms:{" "}
        {CONTACT_EMAIL}.
      </p>
    </div>
  );
}
