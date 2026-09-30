import AppNav from "@/components/AppNav";
import DomainPicker from "@/components/DomainPicker";
import Header from "@/components/Header";
import { requireUser } from "@/lib/auth";
import { DOMAIN_BLURBS, DOMAIN_KEYS, DOMAINS } from "@/lib/diagnostic/domains";

export const metadata = { title: "New diagnostic · Internal Constraint" };

export default async function NewDiagnosticPage() {
  const user = await requireUser();
  const options = DOMAIN_KEYS.map((key) => ({ key, label: DOMAINS[key].label, blurb: DOMAIN_BLURBS[key] }));
  return (
    <>
      <AppNav email={user.email} />
      <Header title="Internal constraint diagnostic" subtitle="Choose a domain to begin" />
      <DomainPicker options={options} />
    </>
  );
}
