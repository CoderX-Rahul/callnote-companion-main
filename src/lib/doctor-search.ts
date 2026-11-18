export type SearchDoctor = { id: string; name: string; specialty: string | null; clinic: string | null; city: string | null };

export function searchDoctors<T extends SearchDoctor>(doctors: T[], query: string): T[] {
  const terms = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return doctors.filter((doctor) => {
    const text = [doctor.name, doctor.specialty, doctor.clinic, doctor.city, doctor.id].filter(Boolean).join(" ").toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}

export function unresolvedQuestions(questions: string[], doctorId: string | null, dateKnown: boolean) {
  return questions.filter((question) => !(doctorId && /\bdoctor\b/i.test(question)) &&
    !(dateKnown && /\b(?:time|call date)\b/i.test(question)));
}