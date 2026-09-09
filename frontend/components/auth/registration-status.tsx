"use client";

import * as React from "react";

/**
 * Whether this server is accepting new accounts.
 *
 * `ALLOW_REGISTRATION=false` makes `POST /api/auth/register` return 403
 * `registration_disabled` — and that is the ONLY way a client can find out.
 * `GET /api/health` reports mode, provider, model and compiler, but not this,
 * so there is nothing to ask before the first attempt. (Getting that flag into
 * health is the one backend change this feature actually wants; see the report.)
 *
 * What is NOT done here is worth stating: no speculative probe. Firing a
 * deliberately-invalid registration on page load purely to read the status code
 * would work — the 403 is raised before email validation — but it puts a bogus
 * registration attempt in the operator's logs on every visit to answer a
 * question the health endpoint should be answering. Discovering it honestly on
 * the first real attempt costs one form submission, once.
 *
 * So the answer starts UNKNOWN, becomes `false` the moment a register attempt
 * is refused, and is remembered for the rest of the visit. The provider lives
 * in the (auth) layout, which does not remount when the user moves between
 * /register and /sign-in, so sign-in stops offering an account the server will
 * not create — without ever having asked.
 */
interface RegistrationStatus {
  /** null while nothing has been learned yet. */
  open: boolean | null;
  markDisabled: () => void;
}

const RegistrationStatusContext = React.createContext<RegistrationStatus>({
  open: null,
  markDisabled: () => {},
});

export function RegistrationStatusProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState<boolean | null>(null);

  const value = React.useMemo<RegistrationStatus>(
    () => ({ open, markDisabled: () => setOpen(false) }),
    [open],
  );

  return (
    <RegistrationStatusContext.Provider value={value}>
      {children}
    </RegistrationStatusContext.Provider>
  );
}

export function useRegistrationStatus(): RegistrationStatus {
  return React.useContext(RegistrationStatusContext);
}
