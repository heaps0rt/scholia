const form=document.querySelector('#sign-in'),error=document.querySelector('#sign-in-error');
form.addEventListener('submit',async (event) => {
  event.preventDefault(); error.hidden=true; const button=form.querySelector('button'); button.disabled=true;
  try {
    const response=await fetch('/auth/login',{ method:'POST',headers:{ 'Content-Type':'application/json' },body:JSON.stringify(Object.fromEntries(new FormData(form))) });
    const result=await response.json(); if (!response.ok) throw new Error(result.error); location.replace('/');
  } catch (failure) { error.textContent=failure.message; error.hidden=false; button.disabled=false; }
});
