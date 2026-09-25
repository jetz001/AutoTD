import { CryptoPageClient } from "@/components/crypto/crypto-page-client"
import { PinSecurityGate } from "@/components/crypto/PinSecurityGate"

export default function Page() {
  return (
    <PinSecurityGate>
      <CryptoPageClient />
    </PinSecurityGate>
  )
}
