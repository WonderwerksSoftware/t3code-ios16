import { isClerkAPIResponseError, useClerk, useUser } from "@clerk/expo";
import { useHostedAuth } from "@clerk/expo/hosted-auth";
import { useGT } from "gt-react-native";
import { useRef, useState } from "react";
import { View } from "react-native";

import { AppBar } from "../../components/ui/AppBar";
import { AppText as Text } from "../../components/ui/AppText";
import { Button } from "../../components/ui/Button";
import * as Dialog from "../../components/ui/Dialog";
import { T3ConnectProfilePage } from "./T3ConnectProfilePage";

export function HostedAuthView(props: {
  readonly signedIn: boolean;
  readonly onHostBack: () => void;
}) {
  const gt = useGT();
  const { startHostedAuth } = useHostedAuth();
  const { signOut } = useClerk();
  const { user } = useUser();
  const [pending, setPending] = useState(false);
  const inProgress = useRef(false);

  const handleAuth = async () => {
    if (inProgress.current) return;
    inProgress.current = true;
    setPending(true);
    let errorMessage: string | undefined;
    try {
      if (props.signedIn) {
        await signOut();
      } else {
        // Clerk owns callback validation and session activation; dismissal leaves auth unchanged.
        await startHostedAuth({ mode: "sign-in" });
      }
    } catch (error) {
      errorMessage =
        (isClerkAPIResponseError(error) && error.errors[0]?.longMessage) || gt("Please try again.");
    }
    inProgress.current = false;
    setPending(false);
    if (errorMessage !== undefined) {
      Dialog.alert(
        props.signedIn ? gt("Could not sign out") : gt("Could not sign in"),
        errorMessage,
      );
    }
  };

  return (
    <View collapsable={false} className="flex-1 bg-sheet">
      <AppBar title="T3 Connect" onClose={props.onHostBack} />
      <View collapsable={false} className="gap-4 px-6 py-6">
        <Text className="text-base text-foreground">
          {props.signedIn
            ? (user?.primaryEmailAddress?.emailAddress ?? gt("Signed in"))
            : gt("Sign in to your T3 account to use {product}.", { product: "T3 Connect" })}
        </Text>
        <Button
          label={props.signedIn ? gt("Sign out") : gt("Sign in")}
          tone={props.signedIn ? "secondary" : "primary"}
          loading={pending}
          onPress={() => void handleAuth()}
        />
      </View>
      {props.signedIn ? <T3ConnectProfilePage /> : null}
    </View>
  );
}
