let authenticationPromise = null;

export function ensureAnonymousAuth(supabase) {
  if (authenticationPromise) return authenticationPromise;

  authenticationPromise = (async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    if (data.session?.user) return data.session.user;

    const { data: signedIn, error: signInError } = await supabase.auth.signInAnonymously();
    if (signInError) throw signInError;
    if (!signedIn.user) throw new Error("匿名ユーザーを取得できませんでした。");
    return signedIn.user;
  })().catch((error) => {
    authenticationPromise = null;
    throw error;
  });

  return authenticationPromise;
}
