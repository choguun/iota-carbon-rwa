import { useCurrentAccount } from "@iota/dapp-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { OwnedObjects } from "./OwnedObjects";

export function WalletStatus() {
  const account = useCurrentAccount();

  return (
    <div className="container py-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle>Wallet Status</CardTitle>
        </CardHeader>
        <CardContent>
          {account ? (
            <div className="flex flex-col space-y-1">
              <p className="text-sm">Wallet connected</p>
              <p className="text-sm text-muted-foreground break-all">
                Address: {account.address}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Wallet not connected</p>
          )}
          <div className="mt-4">
            <OwnedObjects />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
