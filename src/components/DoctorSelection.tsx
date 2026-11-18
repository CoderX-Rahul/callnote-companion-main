import { useState } from "react";
import { Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { searchDoctors, type SearchDoctor } from "@/lib/doctor-search";

export function DoctorSelection({ doctors, value, onChange, suggestedIds }: {
  doctors: SearchDoctor[]; value: string; onChange: (id: string) => void; suggestedIds: string[];
}) {
  const [query, setQuery] = useState("");
  const matches = searchDoctors(doctors, query);
  return <div className="space-y-2">
    <div className="relative">
      <Search className="absolute left-3 top-3.5 h-5 w-5 text-muted-foreground" />
      <input aria-label="Search doctors" placeholder="Name, specialty, clinic or city" value={query} onChange={(e) => setQuery(e.target.value)} className="h-12 w-full rounded-xl border bg-card pl-10 pr-3 text-base outline-none focus:ring-2 focus:ring-ring" />
    </div>
    <div aria-label="Doctor choices" className="max-h-64 overflow-y-auto divide-y rounded-lg border">
      {matches.map((doctor) => <Button key={doctor.id} variant="ghost" aria-pressed={value === doctor.id} onClick={() => onChange(doctor.id)} className="h-auto min-h-16 w-full justify-between whitespace-normal rounded-none px-3 py-3 text-left">
        <span className="min-w-0">
          <span className="block font-medium">{doctor.name} <span className="text-xs text-muted-foreground">{doctor.id}</span></span>
          <span className="block text-xs text-muted-foreground">{[doctor.specialty, doctor.clinic, doctor.city].filter(Boolean).join(" · ")}</span>
          {suggestedIds.includes(doctor.id) && <span className="text-xs text-warning">Suggested match</span>}
        </span>
        {value === doctor.id && <Check className="shrink-0 text-primary" />}
      </Button>)}
      {!matches.length && <p className="p-3 text-sm text-muted-foreground">No matching doctors</p>}
    </div>
  </div>;
}