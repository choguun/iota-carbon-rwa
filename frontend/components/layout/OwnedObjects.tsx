import { useCurrentAccount, useIotaClientQuery } from "@iota/dapp-kit";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";

export function OwnedObjects() {
  const account = useCurrentAccount();
  const { data, isPending, error } = useIotaClientQuery(
    "getOwnedObjects",
    {
      owner: account?.address as string,
    },
    {
      enabled: !!account,
    },
  );

  if (!account) {
    return null;
  }

  if (error) {
    return (
      <Alert variant="destructive" className="mb-4">
        <AlertDescription>Error: {error.message}</AlertDescription>
      </Alert>
    );
  }

  if (isPending || !data) {
    return <Skeleton className="w-full h-16 mb-4" />;
  }

  return (
    <div className="flex flex-col my-2 space-y-2">
      {data.data.length === 0 ? (
        <p className="text-sm text-gray-500">
          No objects owned by the connected wallet
        </p>
      ) : (
        <h2 className="text-xl font-semibold">
          Objects owned by the connected wallet
        </h2>
      )}
      {data.data.map((object) => (
        <div key={object.data?.objectId} className="flex">
          <p className="text-sm">Object ID: {object.data?.objectId}</p>
        </div>
      ))}
    </div>
  );
}
