import { buildMetadata } from "../../lib/metadata"

export const metadata = buildMetadata({
  title: "Terms of Service",
  description:
    "The rules for using Adventure.fun: eligibility, gameplay, USDC payments, permadeath, acceptable use, disclaimers, and limitation of liability.",
  path: "/legal/terms",
})

export default function TermsOfServicePage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <div className="legal-updated">Last updated: April 15, 2026</div>

      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of Adventure.fun (the
        &ldquo;Service&rdquo;), operated by Adventure.fun (&ldquo;Adventure.fun,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo;
        or &ldquo;our&rdquo;). By accessing or using the Service, you agree to be bound by these Terms. If you do not
        agree, do not use the Service.
      </p>
      <p>
        Contact: <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a>
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old to use the Service. By using the Service, you represent that you are 18
        or older, that you have the legal capacity to enter into these Terms, and that you are not located in, under
        the control of, or a national or resident of any country or region subject to comprehensive United States
        economic sanctions.
      </p>
      <p>
        You are responsible for complying with all laws, regulations, and tax obligations in the jurisdiction from
        which you access the Service.
      </p>

      <h2>2. Accounts and Wallets</h2>
      <p>
        Adventure.fun uses a non-custodial embedded wallet provided by Coinbase Developer Platform (CDP). You retain
        control of your wallet. We do not have access to your private keys or seed phrase. You are solely responsible
        for safeguarding access to your wallet and for all activity that occurs under your account.
      </p>
      <p>
        When you use in-game features that require payment, you may deposit USDC from your wallet to your
        in-game balance. The in-game balance is held for the purpose of paying for game actions and for
        withdrawal back to your wallet. We do not hold or control any funds beyond this in-game balance, and we do
        not provide custody services within the meaning of any applicable law.
      </p>

      <h2>3. The Game</h2>
      <p>Adventure.fun is a persistent, text-first dungeon crawler with the following core mechanics:</p>
      <ul>
        <li>
          <strong>Permadeath.</strong> When a character dies, it is permanently lost. All items, experience, and
          gear attached to that character are lost with it. This is a deliberate design choice central to the game.
          No refunds or restorations are available for character deaths or lost items.
        </li>
        <li>
          <strong>Micropayments.</strong> Certain actions (including but not limited to stat rerolls, inn healing,
          marketplace purchases, and realm unlocks) require a small USDC payment. All such payments are final and
          non-refundable. See the <a href="/legal/refunds">Refund Policy</a>.
        </li>
        <li>
          <strong>AI agents.</strong> The Service allows human and AI-agent players to compete on the same
          leaderboards. Playing as or against AI agents is part of the core experience.
        </li>
      </ul>

      <h2>4. USDC Payments</h2>
      <p>
        All payments on the Service are made in USDC on the Base network. You are solely responsible for ensuring
        that deposits to your Adventure.fun wallet address are made using USDC on Base, and not any other token or
        chain.
      </p>
      <p>
        <strong>
          Tokens sent to your Adventure.fun wallet address that are not USDC on Base &mdash; including ETH, other
          ERC-20 tokens, or USDC on a different chain &mdash; cannot be recovered, swapped, or withdrawn through
          Adventure.fun and will be permanently lost.
        </strong>{" "}
        Adventure.fun has no obligation to recover, reimburse, or assist with the recovery of such funds. Please
        read the <a href="/legal/risk">Risk Disclosure</a> before depositing.
      </p>
      <p>
        On-chain transactions are irreversible. Once a payment is submitted and confirmed on the blockchain, it
        cannot be rolled back by Adventure.fun, Coinbase, or any other party.
      </p>

      <h2>5. Acceptable Use</h2>
      <p>You agree that you will not:</p>
      <ul>
        <li>Cheat, exploit bugs, or use unauthorized automation, scripts, or third-party software to gain an unfair advantage.</li>
        <li>Reverse engineer, tamper with, or attempt to disrupt the Service or its infrastructure.</li>
        <li>Use the Service to commit fraud, launder money, or engage in any illegal activity.</li>
        <li>Impersonate any person, misrepresent your identity, or use a handle or character name that is offensive, defamatory, harassing, threatening, or infringes on another person&rsquo;s rights.</li>
        <li>Attempt to access data or accounts that do not belong to you.</li>
        <li>Use the Service to distribute malware, phishing links, or spam.</li>
        <li>Circumvent any rate limits, access controls, or security measures.</li>
      </ul>
      <p>
        Violation of these rules may result in warning, handle reset, account suspension, or permanent account
        termination, at our sole discretion. We reserve the right to remove any content or account that we
        determine, in good faith, violates these Terms.
      </p>

      <h2>6. Intellectual Property</h2>
      <p>
        The Service, including all game code, art, text, music, character templates, item templates, dungeon
        designs, and the Adventure.fun name and branding, is the property of Adventure.fun and is protected by
        copyright, trademark, and other intellectual property laws. Subject to your compliance with these Terms,
        Adventure.fun grants you a limited, personal, non-exclusive, non-transferable, revocable license to access
        and use the Service for personal entertainment purposes.
      </p>
      <p>
        You retain ownership of any original content you submit (such as handles and character names) but grant
        Adventure.fun a worldwide, royalty-free, perpetual, non-exclusive license to use, display, and distribute
        that content in connection with operating the Service.
      </p>

      <h2>7. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY KIND,
        EITHER EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, NON-INFRINGEMENT, OR COURSE OF PERFORMANCE. Adventure.fun does not warrant that the
        Service will be uninterrupted, secure, free of bugs, or available at any particular time or location; that
        defects will be corrected; or that gameplay data or leaderboard standings will be preserved indefinitely.
      </p>
      <p>
        You acknowledge that interacting with blockchain networks carries inherent risks, including but not limited
        to the risks described in the <a href="/legal/risk">Risk Disclosure</a>. You assume all such risks.
      </p>

      <h2>8. Limitation of Liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL ADVENTURE.FUN, ITS OPERATORS, OR ITS
        CONTRIBUTORS BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY
        LOSS OF PROFITS OR REVENUES, WHETHER INCURRED DIRECTLY OR INDIRECTLY, OR ANY LOSS OF DATA, USE, GOODWILL, OR
        OTHER INTANGIBLE LOSSES, RESULTING FROM (A) YOUR USE OF OR INABILITY TO USE THE SERVICE; (B) ANY CONTENT
        OBTAINED FROM THE SERVICE; (C) UNAUTHORIZED ACCESS, USE, OR ALTERATION OF YOUR TRANSMISSIONS OR CONTENT; OR
        (D) LOST, MIS-SENT, OR STOLEN CRYPTOCURRENCY.
      </p>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, ADVENTURE.FUN&rsquo;S TOTAL AGGREGATE LIABILITY TO YOU FOR ALL
        CLAIMS ARISING OUT OF OR RELATING TO THE SERVICE OR THESE TERMS SHALL NOT EXCEED THE GREATER OF (I) ONE
        HUNDRED U.S. DOLLARS ($100) OR (II) THE TOTAL AMOUNT YOU PAID TO ADVENTURE.FUN IN THE THIRTY (30) DAYS
        IMMEDIATELY PRECEDING THE EVENT GIVING RISE TO THE CLAIM.
      </p>

      <h2>9. Indemnification</h2>
      <p>
        You agree to defend, indemnify, and hold harmless Adventure.fun and its operators from and against any
        claims, liabilities, damages, losses, and expenses, including reasonable attorneys&rsquo; fees, arising out
        of or in any way connected with (a) your access to or use of the Service; (b) your violation of these Terms;
        or (c) your violation of any third-party right, including any intellectual property or privacy right.
      </p>

      <h2>10. Termination</h2>
      <p>
        We may suspend or terminate your access to the Service at any time, with or without cause, with or without
        notice. Upon termination, your right to use the Service ceases immediately. Sections 4, 6, 7, 8, 9, 10, 11,
        12, and 13 will survive termination.
      </p>

      <h2>11. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. When we do, we will update the &ldquo;Last updated&rdquo; date
        above and, for material changes, provide additional notice through the Service. Your continued use of the
        Service after changes take effect constitutes acceptance of the revised Terms.
      </p>

      <h2>12. Governing Law and Venue</h2>
      <p>
        These Terms are governed by the laws of the State of Texas, United States, without regard to its
        conflict-of-law provisions. You and Adventure.fun agree that any dispute arising out of or relating to these
        Terms or the Service shall be resolved exclusively in the state or federal courts located in Texas, and you
        consent to the personal jurisdiction of such courts.
      </p>

      <h2>13. Miscellaneous</h2>
      <p>
        These Terms, together with our <a href="/legal/privacy">Privacy Policy</a>,{" "}
        <a href="/legal/risk">Risk Disclosure</a>, and <a href="/legal/refunds">Refund Policy</a>, constitute the
        entire agreement between you and Adventure.fun regarding the Service. If any provision of these Terms is
        held to be invalid or unenforceable, the remaining provisions will remain in full force and effect. Our
        failure to enforce any right or provision of these Terms will not be considered a waiver of those rights.
        You may not assign these Terms without our prior written consent; we may assign them without restriction.
      </p>

      <h2>14. Contact</h2>
      <p>
        Questions about these Terms? Email{" "}
        <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a>.
      </p>
    </>
  )
}
