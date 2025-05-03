'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    useIotaClient,
    useSignAndExecuteTransaction,
    useCurrentAccount, // Or useCurrentAccount
} from '@iota/dapp-kit';
import { Transaction } from '@iota/iota-sdk/transactions';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useNetworkVariable } from '@/lib/networkConfig'; // Assuming this exists
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip" // Assuming this is still valid


export default function Home() {
  return (
    <div>
      <h1>Hello World</h1>
    </div>
  );
}
