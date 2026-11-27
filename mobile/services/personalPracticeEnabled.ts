/** Private preview builds opt in to the personal practice flow. */
export function personalPracticeEnabled(): boolean {
  return process.env.EXPO_PUBLIC_PERSONAL_PRACTICE === "1";
}
