import { buildMetadata } from "../../lib/metadata"

export const metadata = buildMetadata({
  title: "Privacy Policy",
  description:
    "How Adventure.fun collects, uses, and stores personal data. Wallet addresses, handles, gameplay data, and browser storage disclosure.",
  path: "/legal/privacy",
})

export default function PrivacyPolicyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <div className="legal-updated">Last updated: April 15, 2026</div>

      <p>
        Adventure.fun (&ldquo;Adventure.fun,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or &ldquo;our&rdquo;) operates the Adventure.fun website and game
        (the &ldquo;Service&rdquo;). This Privacy Policy explains what information we collect, how we use it, and the
        choices you have. By accessing or using the Service you agree to the collection and use of information in
        accordance with this policy.
      </p>
      <p>
        Contact: <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a>
      </p>

      <h2>1. Information We Collect</h2>
      <p>
        Adventure.fun is a crypto-native game. Accounts are created by connecting an EVM-compatible embedded wallet
        rather than a traditional email/password signup. We collect only the information needed to operate the Service:
      </p>
      <ul>
        <li>
          <strong>Wallet address.</strong> Your public EVM wallet address, which is used as your account identifier.
          This is inherently public information on the blockchain.
        </li>
        <li>
          <strong>Authentication challenge.</strong> A one-time nonce we ask your wallet to sign to prove you control
          the address. We store the nonce and resulting signature only long enough to validate the login; we never
          request, receive, or store your private keys.
        </li>
        <li>
          <strong>Handle and profile fields.</strong> Your chosen display handle, and any optional X (Twitter) or
          GitHub handles you choose to associate with your profile.
        </li>
        <li>
          <strong>Gameplay data.</strong> Character state, inventory, progression, dungeon runs, deaths, and
          leaderboard standings. This data is necessary to operate the game.
        </li>
        <li>
          <strong>Payment metadata.</strong> When you make an in-game payment via x402 or withdraw from your in-game
          balance, we record the on-chain transaction hash and amount. These transactions are public on the Base
          blockchain.
        </li>
        <li>
          <strong>Network and device data.</strong> Standard server logs including IP address, user agent, timestamps,
          and request paths. We use these to operate the Service, investigate abuse, and maintain security.
        </li>
      </ul>
      <p>
        We do <strong>not</strong> collect: your real name, postal address, phone number, government ID, private keys,
        or seed phrases. We do not use advertising trackers, analytics SDKs, or third-party marketing pixels.
      </p>

      <h2>2. Browser Storage</h2>
      <p>
        Adventure.fun does not set any tracking cookies and does not load any analytics scripts. To keep you signed in
        between visits, we store a signed authentication token (JWT) in your browser&rsquo;s <code>localStorage</code>
        under the key <code>adventure_auth</code>. This is strictly necessary to operate the Service and falls outside
        the EU ePrivacy Directive&rsquo;s consent requirement for non-essential storage.
      </p>
      <p>
        You can clear this storage at any time by signing out, clearing your browser&rsquo;s site data, or using your
        browser&rsquo;s private/incognito mode. Clearing it will sign you out but will not delete your account or
        gameplay history.
      </p>

      <h2>3. Third-Party Services</h2>
      <p>
        The Service uses a small number of third-party processors. Your interactions with these services are also
        governed by their own privacy policies:
      </p>
      <ul>
        <li>
          <strong>Coinbase Developer Platform (CDP).</strong> We use CDP&rsquo;s embedded wallet infrastructure for
          account creation and message signing. CDP holds your wallet keys on your behalf and is bound by
          Coinbase&rsquo;s privacy terms.
        </li>
        <li>
          <strong>Base blockchain.</strong> All on-chain payments settle publicly on the Base network. Transaction
          amounts, addresses, and timestamps are visible to anyone. This is an inherent property of public
          blockchains and cannot be reversed or redacted.
        </li>
        <li>
          <strong>Hosting and infrastructure providers.</strong> Our servers and database are operated through
          standard cloud infrastructure providers that may process your data under their own terms.
        </li>
      </ul>

      <h2>4. How We Use Your Information</h2>
      <ul>
        <li>To operate the game and authenticate you between sessions.</li>
        <li>To display leaderboards, public profiles, and other player-visible game state.</li>
        <li>To process in-game payments and withdrawals.</li>
        <li>To detect and prevent abuse, cheating, fraud, and exploitation of game mechanics.</li>
        <li>To communicate with you if you contact us directly.</li>
        <li>To comply with legal obligations.</li>
      </ul>
      <p>
        We do not sell, rent, or trade your personal information to third parties. We do not use your data for
        targeted advertising.
      </p>

      <h2>5. Public Information</h2>
      <p>
        Some information is public by design: your handle, character names, death notices, leaderboard standings,
        gameplay history, and any X or GitHub handles you choose to associate with your profile. Do not add
        information to your profile that you do not want others to see.
      </p>

      <h2>6. Data Retention</h2>
      <p>
        We retain account, character, and gameplay data for as long as your account exists, and as required to
        operate leaderboards and legacy (legend) records. If you request account deletion, we will delete or
        anonymize personal data associated with your account within a reasonable period, subject to legal retention
        requirements. On-chain transaction data cannot be deleted from the public blockchain.
      </p>

      <h2>7. Your Rights</h2>
      <p>
        Depending on your jurisdiction, you may have the right to access, correct, delete, or export the personal data
        we hold about you, and to object to or restrict certain processing. If you are a resident of the European
        Economic Area, United Kingdom, or California, you may have additional rights under the GDPR, UK GDPR, or CCPA
        respectively.
      </p>
      <p>
        To exercise any of these rights, contact us at{" "}
        <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a>. We will respond within a
        reasonable period. Note that for security reasons we may need to verify that you control the wallet
        associated with the account before acting on a request.
      </p>

      <h2>8. Children</h2>
      <p>
        The Service is not intended for individuals under the age of 18. We do not knowingly collect personal
        information from children. If you believe a child has provided us with personal information, contact us and
        we will delete the account.
      </p>

      <h2>9. Security</h2>
      <p>
        We take reasonable measures to protect the information we collect from unauthorized access, alteration,
        disclosure, or destruction. However, no method of transmission over the internet or electronic storage is
        completely secure, and we cannot guarantee absolute security.
      </p>

      <h2>10. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. When we do, we will update the &ldquo;Last updated&rdquo;
        date above and, for material changes, provide additional notice through the Service. Your continued use of
        the Service after changes constitutes acceptance of the revised policy.
      </p>

      <h2>11. Governing Law</h2>
      <p>
        This Privacy Policy is governed by the laws of the State of Texas, United States, without regard to
        its conflict-of-law provisions.
      </p>

      <h2>12. Contact</h2>
      <p>
        Questions about this Privacy Policy? Email{" "}
        <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a>.
      </p>
    </>
  )
}
