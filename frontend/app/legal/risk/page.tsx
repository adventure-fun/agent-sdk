import { buildMetadata } from "../../lib/metadata"

export const metadata = buildMetadata({
  title: "Risk Disclosure",
  description:
    "Risks of using Adventure.fun: USDC-only deposits, non-refundable payments, permadeath, wallet custody, blockchain and smart contract risks.",
  path: "/legal/risk",
})

export default function RiskDisclosurePage() {
  return (
    <>
      <h1>Risk Disclosure</h1>
      <div className="legal-updated">Last updated: April 15, 2026</div>

      <p>
        Adventure.fun is a crypto-native game that uses real on-chain payments and a non-custodial embedded
        wallet. Before you deposit any USDC or play with real value, please read and understand the following
        risks. This Risk Disclosure is part of our <a href="/legal/terms">Terms of Service</a>.
      </p>

      <h2>1. USDC on Base Only &mdash; Other Tokens Are Permanently Lost</h2>
      <p>
        Your Adventure.fun wallet accepts <strong>only USDC on the Base network</strong>. If you send any other
        token to this address &mdash; including but not limited to:
      </p>
      <ul>
        <li>ETH or any other native coin</li>
        <li>USDC on Ethereum, Polygon, Arbitrum, Optimism, or any chain other than Base</li>
        <li>Any other ERC-20 token (DAI, USDT, wrapped assets, etc.)</li>
        <li>NFTs or other non-fungible tokens</li>
      </ul>
      <p>
        &hellip; those funds or assets <strong>cannot</strong> be recovered, swapped, or withdrawn through the
        Service. Adventure.fun has no technical ability to convert non-USDC tokens into USDC, and no obligation to
        reimburse you for misdirected transfers. Double-check the token and the network before every deposit.
      </p>

      <h2>2. Micropayments Are Final and Non-Refundable</h2>
      <p>
        In-game actions that require payment (such as stat rerolls, inn healing, marketplace purchases, realm
        unlocks, and similar) are processed via x402 on the Base blockchain. On-chain transactions are
        irreversible once confirmed. No refunds are issued for any in-game purchase, regardless of gameplay
        outcome. See the <a href="/legal/refunds">Refund Policy</a> for details.
      </p>

      <h2>3. Permadeath Means Permanent Loss of Progress</h2>
      <p>
        Adventure.fun is intentionally designed around permadeath. When a character dies, it is gone forever. Any
        items, equipment, experience, in-character progression, and paid-for power-ups tied to that character are
        lost with it. No restorations, rollbacks, or refunds are available for character death, regardless of
        cause (player error, bad luck, bug, server incident, or otherwise).
      </p>
      <p>
        Do not pay for services on a character whose loss you are not prepared to accept.
      </p>

      <h2>4. Deposit Only What You Can Afford to Lose</h2>
      <p>
        We recommend depositing only the amount you intend to spend in the near term. Most game actions cost a
        fraction of a dollar, so a small deposit can last many sessions. Keeping a small in-game balance limits
        your exposure to any single incident. You can withdraw unused USDC back to your wallet at any time
        through the hub.
      </p>

      <h2>5. Wallet Security Is Your Responsibility</h2>
      <p>
        Adventure.fun uses a non-custodial embedded wallet provided by Coinbase Developer Platform (CDP). Your
        keys are managed by CDP on your behalf; Adventure.fun never sees or stores your private keys or seed
        phrase. You are responsible for maintaining the security of your CDP account and for any activity that
        occurs through your wallet. If your CDP account is compromised, Adventure.fun cannot recover funds or
        restore access on your behalf.
      </p>

      <h2>6. Smart Contract and Software Risk</h2>
      <p>
        The Service relies on smart contracts, on-chain settlement (x402), and custom backend software. All
        software carries the risk of bugs, vulnerabilities, and unintended behavior. Although we take reasonable
        care to test and secure the Service, we cannot guarantee that it is bug-free or immune to exploit. You
        accept this risk by using the Service.
      </p>

      <h2>7. Blockchain and Network Risk</h2>
      <p>
        The Base network and the broader Ethereum ecosystem may experience downtime, congestion, forks, reorgs,
        regulatory changes, or other disruptions outside Adventure.fun&rsquo;s control. Such events may cause
        delays, failed transactions, or temporary inability to deposit or withdraw. Adventure.fun is not
        responsible for network-level issues.
      </p>

      <h2>8. Volatility of Underlying Assets</h2>
      <p>
        USDC is a stablecoin designed to track the U.S. dollar, but stablecoins can and have temporarily lost
        their peg. The value of your USDC balance may fluctuate. Adventure.fun does not issue USDC and has no
        control over its redeemability or market value.
      </p>

      <h2>9. Regulatory Risk</h2>
      <p>
        Crypto regulation varies significantly by jurisdiction and is evolving rapidly. You are solely
        responsible for ensuring that your use of the Service complies with the laws of your jurisdiction,
        including tax reporting. Adventure.fun makes no representation that the Service is appropriate or
        available in any particular jurisdiction.
      </p>

      <h2>10. No Financial Advice</h2>
      <p>
        Nothing on this site or from Adventure.fun constitutes investment, financial, legal, or tax advice.
        Adventure.fun is a game and is not an investment product, security, or financial instrument. Do not use
        the Service as part of any investment strategy.
      </p>

      <h2>11. Acceptance of Risk</h2>
      <p>
        By depositing USDC to your Adventure.fun wallet and by using the Service, you acknowledge that you have
        read, understood, and accepted the risks described above, and you agree that Adventure.fun is not liable
        for losses arising from any of these risks to the maximum extent permitted by law.
      </p>

      <p>
        Questions? Email <a href="mailto:adventure.fungame@gmail.com">adventure.fungame@gmail.com</a>.
      </p>
    </>
  )
}
