const parts=[1,2,3,4,5].map(n=>`src/app.part${n}.txt`);
try{
  const responses=await Promise.all(parts.map(path=>fetch(path,{cache:'no-store'})));
  for(const response of responses)if(!response.ok)throw new Error(`Could not load ${response.url}`);
  const source=(await Promise.all(responses.map(response=>response.text()))).join('');
  const moduleUrl=URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
  await import(moduleUrl);
  URL.revokeObjectURL(moduleUrl);
}catch(error){
  console.error(error);
  const status=document.getElementById('status');
  if(status)status.textContent=`Startup error: ${error.message}`;
}
