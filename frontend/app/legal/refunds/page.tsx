import { buildMetadata } from "../../lib/metadata"

export const metadata = buildMetadata({
  title: "Refund Policy",
  description:
    "Adventure.fun refund policy: in-game payments are final and non-refundable, character deaths are permanent, misdirected transfers cannot be recovered.",
  path: "/legal/refunds",
})

export default function RefundPolicyPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <div className="legal-updated">Last updated: April 15, 2026</div>

      <p>
        This Refund Policy explains when and how refunds are handled at Adventure.fun. Please read it carefully
        before making any in-game payment. This Refund Policy is part of our{" "}
        <a href="/legal/terms">Terms of Service</a>.
      </p>

      <h2>1. All In-Game Payments Are Final</h2>
      <p>
        All in-game actions that require payment &mdash; including but not limited to stat rerolls, inn healing,
        marketplace purchases, realm unlocks, and any other USDC-priced feature &mdash; are final and{" "}
        <strong>non-refundable</strong> once the on-chain transaction is confirmed. The Base blockchain is a
        public, irreversible settlement layer; Adventure.fun has no technical ability to reverse a confirmed
        transaction.
      </p>

      <h2>2. No Refunds for Gameplay Outcomes</h2>
      <p>
        Adventure.fun is designed around permadeath. Characters can and will die, and when they do, all items,
        gear, experience, and any paid-for power-ups attached to that character are permanently lost. This
        includes:
      </p>
      <ul>
        <li>Character deaths from combat, traps, environmental hazards, or any in-game cause.</li>
        <li>Loss of items, gear, consumables, or currency tied to a deceased character.</li>
        <li>Unfavorable outcomes from randomized mechanics such as stat rerolls, loot drops, or combat rolls.</li>
        <li>Gameplay decisions you regret or that did not turn out as you expected.</li>
      </ul>
      <p>
        <strong>No refunds are issued for any of the above</strong>, regardless of how the outcome occurred.
        This is a deliberate design choice central to the game&rsquo;s stakes.
      </p>

      <h2>3. Misdirected Deposits Cannot Be Recovered</h2>
      <p>
        Your Adventure.fun wallet accepts only USDC on the Base network. If you send any other token to your
        wallet address &mdash; ETH, other ERC-20 tokens, USDC on a different chain, or NFTs &mdash; those funds
        cannot be converted, recovered, or withdrawn through Adventure.fun, and no refund is possible.
      </p>
      <p>
        Always double-check both the asset and the network before sending a deposit. See the{" "}
        <a href="/legal/risk">Risk Disclosure</a> for more detail.
      </p>

      <h2>4. Chargebacks</h2>
      <p>
        Crypto payments cannot be charged back through a bank or card network. Adventure.fun does not accept
        credit-card payments directly. If we ever introduce card-based payments and you initiate a chargeback
        instead of contacting us first, we may suspend or permanently terminate your account.
      </p>

      <h2>5. Exceptional Circumstances</h2>
      <p>
        In rare and genuinely exceptional cases &mdash; for example, a confirmed platform-side bug that caused a
        payment to be charged without delivering the paid service, or a double-charge caused by our software
        &mdash; we may, at our sole discretion, issue a refund or in-game credit. To request consideration,
        email <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a> with:
      </p>
      <ul>
        <li>Your wallet address and handle</li>
        <li>The transaction hash of the payment in question</li>
        <li>A clear description of what happened and what outcome you expected</li>
      </ul>
      <p>
        We will review the request in good faith, but we make <strong>no guarantee</strong> that a refund or
        credit will be issued. Our decision is final.
      </p>

      <h2>6. Withdrawals vs. Refunds</h2>
      <p>
        Withdrawing unused USDC from your in-game balance back to your wallet is <em>not</em> a refund &mdash; it
        is a routine user-initiated transfer of funds you still control. You can withdraw your remaining balance
        at any time through the hub, subject to the per-withdraw maximum shown in the Service.
      </p>

      <h2>7. Changes to This Policy</h2>
      <p>
        We may update this Refund Policy from time to time. Material changes will be noted by updating the
        &ldquo;Last updated&rdquo; date above. Your continued use of the Service after changes take effect
        constitutes acceptance of the revised policy.
      </p>

      <h2>8. Contact</h2>
      <p>
        Questions about this Refund Policy? Email{" "}
        <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a>.
      </p>
    </>
  )
}
