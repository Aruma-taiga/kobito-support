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
