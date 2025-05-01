'use client';

import { useCurrentAccount } from "@iota/dapp-kit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle } from 'lucide-react';
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
            <Alert variant="default" className="mt-2">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="ml-1">
                Wallet not connected.
              </AlertDescription>
            </Alert>
          )}
          {account && (
            <div className="mt-4">
              <OwnedObjects />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
