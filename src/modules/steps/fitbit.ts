import {
  AuthRequest,
  ResponseType,
  TokenResponse,
  exchangeCodeAsync,
  makeRedirectUri,
  refreshAsync,
  revokeAsync,
} from "expo-auth-session";
import { Platform } from "react-native";
import {
  deleteStoredValue,
  getStoredValue,
  setStoredValue,
} from "./store";
import { getFitbitClientId, isFitbitClientConfigured } from "./fitbit-config";

const FITBIT_DISCOVERY = {
  authorizationEndpoint: "https://www.fitbit.com/oauth2/authorize",
  tokenEndpoint: "https://api.fitbit.com/oauth2/token",
  revocationEndpoint: "https://api.fitbit.com/oauth2/revoke",
} as const;

const FITBIT_SESSION_KEY = "walklog.fitbit.session";
const FITBIT_SCOPES = ["activity"];
const FITBIT_CLIENT_ID = getFitbitClientId();
const FITBIT_REDIRECT_URI = makeRedirectUri({
  scheme: "walklog",
  path: "fitbit",
});

type FitbitSession = {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  issuedAt: number;
  scope?: string;
  tokenType: "bearer" | "mac";
};

class FitbitRequestError extends Error {
  status: number;
  body?: string;

  constructor(status: number, body?: string) {
    super(
      body && body.length > 0
        ? `Fitbit request failed with ${status}: ${body}`
        : `Fitbit request failed with ${status}`,
    );
    this.name = "FitbitRequestError";
    this.status = status;
    this.body = body;
  }
}

type FitbitDailyStepsResponse = {
  "activities-steps"?: Array<{
    dateTime?: string;
    value?: number | string;
  }>;
};

export type FitbitPermissionStatus = "granted" | "undetermined" | "unavailable";
export type FitbitStepSyncResult = {
  totalSteps: number;
  syncStatus: "ok" | "error";
  syncMessage?: string;
};

export function isFitbitConfigured() {
  return isFitbitClientConfigured();
}

export async function getFitbitPermissionStatus(): Promise<FitbitPermissionStatus> {
  if (!isFitbitSupported()) {
    return "unavailable";
  }

  const session = await getValidSession();
  return session ? "granted" : "undetermined";
}

export async function connectFitbit() {
  if (!isFitbitSupported()) {
    return false;
  }

  const request = new AuthRequest({
    clientId: FITBIT_CLIENT_ID,
    redirectUri: FITBIT_REDIRECT_URI,
    responseType: ResponseType.Code,
    scopes: FITBIT_SCOPES,
    usePKCE: true,
  });

  const result = await request.promptAsync(FITBIT_DISCOVERY);

  if (result.type !== "success" || !result.params.code || !request.codeVerifier) {
    return false;
  }

  const tokenResponse = await exchangeCodeAsync(
    {
      clientId: FITBIT_CLIENT_ID,
      code: result.params.code,
      redirectUri: FITBIT_REDIRECT_URI,
      extraParams: {
        code_verifier: request.codeVerifier,
      },
    },
    FITBIT_DISCOVERY,
  );

  if (!tokenResponse.accessToken) {
    console.error("Fitbit token exchange returned no access token", {
      hasRefreshToken: Boolean(tokenResponse.refreshToken),
      issuedAt: tokenResponse.issuedAt,
      expiresIn: tokenResponse.expiresIn,
      scope: tokenResponse.scope ?? null,
      tokenType: tokenResponse.tokenType ?? "bearer",
      rawResponse: tokenResponse.rawResponse ?? null,
    });
    logRawTokens("Fitbit token exchange raw values", {
      accessToken: tokenResponse.accessToken,
      refreshToken: tokenResponse.refreshToken,
    });
    return false;
  }

  logRawTokens("Fitbit token exchange raw values", {
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
  });

  await writeSession({
    accessToken: tokenResponse.accessToken,
    refreshToken: tokenResponse.refreshToken,
    expiresIn: tokenResponse.expiresIn,
    issuedAt: tokenResponse.issuedAt,
    scope: tokenResponse.scope,
    tokenType: tokenResponse.tokenType ?? "bearer",
  });

  return true;
}

export async function disconnectFitbit() {
  const session = await readSession();

  try {
    if (session?.accessToken && isFitbitSupported()) {
      await revokeAsync(
        {
          clientId: FITBIT_CLIENT_ID,
          token: session.accessToken,
        },
        FITBIT_DISCOVERY,
      );
    }
  } catch {
    // Clear local credentials even if Fitbit revocation fails.
  } finally {
    await deleteStoredValue(FITBIT_SESSION_KEY);
  }
}

export async function getTodayFitbitStepCount() {
  return getFitbitStepCountForDate(new Date());
}

export async function getFitbitStepCountForWindow(startedAt: Date, endedAt: Date) {
  let session = await getValidSession();

  if (!session) {
    console.error("Fitbit step sync failed: no valid session", {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
    });
    return {
      totalSteps: 0,
      syncStatus: "error" as const,
      syncMessage: "Fitbit needs to reconnect before steps can sync.",
    };
  }

  console.log("Fitbit step sync session", describeSession(session));

  try {
    const total = await getFitbitStepCountForDateWithToken(
      session.accessToken,
      endedAt,
    );

    return {
      totalSteps: total,
      syncStatus: "ok" as const,
    };
  } catch (error) {
    if (isInvalidTokenError(error)) {
      console.log("Fitbit step sync hit invalid_token, retrying with refresh", {
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
      });

      session = await refreshSession();

      if (session) {
        try {
          const total = await getFitbitStepCountForDateWithToken(
            session.accessToken,
            endedAt,
          );

          return {
            totalSteps: total,
            syncStatus: "ok" as const,
          };
        } catch (retryError) {
          console.error("Fitbit step sync retry failed", {
            startedAt: startedAt.toISOString(),
            endedAt: endedAt.toISOString(),
            message: getErrorMessage(retryError),
            stack: retryError instanceof Error ? retryError.stack : undefined,
          });
          return {
            totalSteps: 0,
            syncStatus: "error" as const,
            syncMessage: getFitbitSyncMessage(retryError),
          };
        }
      }
    }

    console.error("Fitbit step sync failed", {
      startedAt: startedAt.toISOString(),
      endedAt: endedAt.toISOString(),
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      totalSteps: 0,
      syncStatus: "error" as const,
      syncMessage: getFitbitSyncMessage(error),
    };
  }
}

async function getFitbitStepCountForDate(date: Date) {
  let session = await getValidSession();

  if (!session) {
    console.error("Fitbit day step sync failed: no valid session", {
      date: date.toISOString(),
    });
    return {
      totalSteps: 0,
      syncStatus: "error" as const,
      syncMessage: "Fitbit needs to reconnect before steps can sync.",
    };
  }

  console.log("Fitbit day step sync session", describeSession(session));

  try {
    const total = await getFitbitStepCountForDateWithToken(session.accessToken, date);

    return {
      totalSteps: total,
      syncStatus: "ok" as const,
    };
  } catch (error) {
    if (isInvalidTokenError(error)) {
      console.log("Fitbit day step sync hit invalid_token, retrying with refresh", {
        date: date.toISOString(),
      });

      session = await refreshSession();

      if (session) {
        try {
          const total = await getFitbitStepCountForDateWithToken(
            session.accessToken,
            date,
          );

          return {
            totalSteps: total,
            syncStatus: "ok" as const,
          };
        } catch (retryError) {
          console.error("Fitbit day step sync retry failed", {
            date: date.toISOString(),
            message: getErrorMessage(retryError),
            stack: retryError instanceof Error ? retryError.stack : undefined,
          });
          return {
            totalSteps: 0,
            syncStatus: "error" as const,
            syncMessage: getFitbitSyncMessage(retryError),
          };
        }
      }
    }

    console.error("Fitbit day step sync failed", {
      date: date.toISOString(),
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      totalSteps: 0,
      syncStatus: "error" as const,
      syncMessage: getFitbitSyncMessage(error),
    };
  }
}

function isFitbitSupported() {
  return isFitbitConfigured() && Platform.OS !== "web";
}

async function getValidSession() {
  if (!isFitbitSupported()) {
    return null;
  }

  const session = await readSession();

  if (!session) {
    return null;
  }

  if (!session.accessToken) {
    console.error("Fitbit stored session is missing an access token", {
      ...describeSession(session),
    });
    logRawTokens("Fitbit stored session raw values", session);
    await deleteStoredValue(FITBIT_SESSION_KEY);
    return null;
  }

  const tokenResponse = new TokenResponse({
    accessToken: session.accessToken,
    expiresIn: session.expiresIn,
    issuedAt: session.issuedAt,
    refreshToken: session.refreshToken,
    scope: session.scope,
    tokenType: session.tokenType,
  });

  console.log("Fitbit stored session", {
    ...describeSession(session),
    shouldRefresh: tokenResponse.shouldRefresh(),
  });

  if (!tokenResponse.shouldRefresh()) {
    return session;
  }

  if (!session.refreshToken) {
    await deleteStoredValue(FITBIT_SESSION_KEY);
    return null;
  }

  return refreshSession(session);
}

async function refreshSession(existingSession?: FitbitSession | null) {
  const session = existingSession ?? (await readSession());

  if (!session?.refreshToken) {
    if (session) {
      await deleteStoredValue(FITBIT_SESSION_KEY);
    }
    return null;
  }

  try {
    console.log("Fitbit refreshing session", describeSession(session));

    const refreshed = await refreshAsync(
      {
        clientId: FITBIT_CLIENT_ID,
        refreshToken: session.refreshToken,
        scopes: FITBIT_SCOPES,
      },
      FITBIT_DISCOVERY,
    );

    const nextSession: FitbitSession = {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken ?? session.refreshToken,
      expiresIn: refreshed.expiresIn,
      issuedAt: refreshed.issuedAt,
      scope: refreshed.scope ?? session.scope,
      tokenType: refreshed.tokenType ?? session.tokenType,
    };

    console.log("Fitbit refreshed session", describeSession(nextSession));
    await writeSession(nextSession);
    return nextSession;
  } catch (error) {
    console.error("Fitbit token refresh failed", {
      message: getErrorMessage(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    await deleteStoredValue(FITBIT_SESSION_KEY);
    return null;
  }
}

async function getFitbitStepCountForDateWithToken(accessToken: string, date: Date) {
  const url =
    "https://api.fitbit.com/1/user/-/activities/steps/date/" +
    `${formatDate(date)}/${formatDate(date)}/1min.json`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const body = await response.text();
    const isInvalidToken = response.status === 401 && body.includes("invalid_token");
    const logFn = isInvalidToken ? console.log : console.error;

    logFn("Fitbit step request failed", {
      status: response.status,
      url,
      body,
    });
    throw new FitbitRequestError(response.status, body);
  }

  const payload = (await response.json()) as FitbitDailyStepsResponse;
  const value = Number(payload["activities-steps"]?.[0]?.value ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

async function readSession() {
  const raw = await getStoredValue(FITBIT_SESSION_KEY);

  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as FitbitSession;
  } catch {
    await deleteStoredValue(FITBIT_SESSION_KEY);
    return null;
  }
}

async function writeSession(session: FitbitSession) {
  await setStoredValue(FITBIT_SESSION_KEY, JSON.stringify(session));
}

function getFitbitSyncMessage(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("401")) {
      return "Fitbit login expired while reading steps. Reconnect your account and try again.";
    }

    if (error.message.includes("403")) {
      return "This Fitbit connection can sign in, but step sync is not allowed for this account or app setup.";
    }

    if (error.message.includes("429")) {
      return "Fitbit rate-limited step sync. Try refreshing again in a minute.";
    }
  }

  return "We couldn't sync Fitbit steps just now. Open Fitbit to sync the device, then refresh here.";
}

function isInvalidTokenError(error: unknown) {
  return (
    error instanceof FitbitRequestError &&
    error.status === 401 &&
    typeof error.body === "string" &&
    error.body.includes("invalid_token")
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function describeSession(session: FitbitSession) {
  return {
    accessToken: redactToken(session.accessToken),
    refreshToken: redactToken(session.refreshToken),
    issuedAt: session.issuedAt,
    expiresIn: session.expiresIn,
    expiresAt:
      session.expiresIn !== undefined
        ? new Date((session.issuedAt + session.expiresIn) * 1000).toISOString()
        : null,
    scope: session.scope ?? null,
    tokenType: session.tokenType,
    hasRefreshToken: Boolean(session.refreshToken),
  };
}

function redactToken(token?: string) {
  if (!token) {
    return null;
  }

  if (token.length <= 8) {
    return `${token.slice(0, 2)}...${token.slice(-2)}`;
  }

  return `${token.slice(0, 4)}...${token.slice(-4)}`;
}

function logRawTokens(
  label: string,
  session: { accessToken?: string; refreshToken?: string },
) {
  if (!__DEV__) {
    return;
  }

  console.log(label, {
    accessToken: session.accessToken ?? null,
    refreshToken: session.refreshToken ?? null,
  });
}
