/**
 * Profile edit validation, shared by the edit sheet. Mirrors the onboarding
 * rules where they overlap (trimmed names, a real IANA timezone) without
 * touching the onboarding RPC. Pure, so it is testable without a device.
 */
export type ProfileEditInput = {
  firstName: string;
  lastName: string;
  timezone: string;
};

export type ProfileEditValue = {
  firstName: string | null;
  lastName: string | null;
  timezone: string;
};

export type ProfileEditResult =
  | { ok: true; value: ProfileEditValue }
  | { ok: false; field: "name" | "timezone"; message: string };

const NAME_MAX = 60;

function cleanName(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function isValidTimeZone(value: string): boolean {
  const zone = value.trim();
  if (zone === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export function parseProfileEdit(input: ProfileEditInput): ProfileEditResult {
  const firstName = cleanName(input.firstName);
  const lastName = cleanName(input.lastName);

  if (firstName === "" && lastName === "") {
    return {
      ok: false,
      field: "name",
      message: "Add at least a first or last name.",
    };
  }
  if (firstName.length > NAME_MAX || lastName.length > NAME_MAX) {
    return {
      ok: false,
      field: "name",
      message: `Names can be at most ${NAME_MAX} characters.`,
    };
  }
  if (!isValidTimeZone(input.timezone)) {
    return {
      ok: false,
      field: "timezone",
      message: "Use a valid IANA timezone, like Asia/Kolkata or UTC.",
    };
  }

  return {
    ok: true,
    value: {
      firstName: firstName === "" ? null : firstName,
      lastName: lastName === "" ? null : lastName,
      timezone: input.timezone.trim(),
    },
  };
}
