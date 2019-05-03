echo ; alias goto=true ; alias function=true # > NUL
echo ; function goto { true; } # > NUL

goto win

command -v busybox > /dev/null && { busybox httpd -fp 8080 && exit 0; }
command -v python > /dev/null && { python -m SimpleHTTPServer 8080; exit 0; }

exit 1

:win
@powershell -ExecutionPolicy ByPass -File serve.ps1
