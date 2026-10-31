import { createContext, type ReactNode, useContext } from "react";

export interface ContactSettings {
  lineEnabled: boolean;
  contactEmail: string | null;
}

const ContactContext = createContext<ContactSettings>({
  lineEnabled: false,
  contactEmail: null,
});

export function ContactProvider({
  value,
  children,
}: {
  value: ContactSettings;
  children: ReactNode;
}) {
  return (
    <ContactContext.Provider value={value}>{children}</ContactContext.Provider>
  );
}

export function useContact(): ContactSettings {
  return useContext(ContactContext);
}

/** Renders the configured contact address as a mailto link, or nothing. */
export function ContactEmailLink() {
  const { contactEmail } = useContact();
  if (!contactEmail) return null;
  return <a href={`mailto:${contactEmail}`}>{contactEmail}</a>;
}

/**
 * Renders a message that contains "（{email}）" with the configured contact
 * address as a mailto link. Without a configured address the parenthesised
 * part is dropped instead of printing a placeholder.
 */
export function MailText({ template }: { template: string }) {
  const { contactEmail } = useContact();
  const placeholder = "{email}";
  if (!contactEmail) return <>{template.replace(`（${placeholder}）`, "")}</>;
  const [before = "", after = ""] = template.split(placeholder);
  return (
    <>
      {before}
      <ContactEmailLink />
      {after}
    </>
  );
}

/** mailto href for the configured contact address, optionally with a subject. */
export function contactMailHref(
  contactEmail: string | null,
  subject?: string,
): string | null {
  if (!contactEmail) return null;
  return subject
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`
    : `mailto:${contactEmail}`;
}
