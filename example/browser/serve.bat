echo \
@goto win \
> /dev/null

command -v busybox > /dev/null && {
	busybox httpd -fp 8080 &&
	exit 0
}

command -v python > /dev/null && {
	python -m $(python -c 'import sys; print("SimpleHTTPServer" if sys.version_info.major < 3 else "http.server")') 8080
	exit 0
}

exit 1

:win
@echo off
setlocal EnableDelayedExpansion
set code=#
set ps=0
set lf=^


for /F "usebackq tokens=*" %%i in (`findstr -bv @@ "%~f0"`) do (
@@	if !ps!==1 set code=!code!!lf!%%i
	if "%%i"=="goto :eof" set ps=1
)

@@powershell -NoProfile -Command !code!
goto :eof

# For MimeMapping
[System.Reflection.Assembly]::LoadWithPartialName('System.Web')

# Start web server listening only on localhost.
$app = New-Object System.Net.HttpListener
$app.Prefixes.Add('http://localhost:8080/')
$app.Prefixes.Add('http://127.0.0.1:8080/')

try {
	$app.Start()
} catch [System.Net.HttpListenerException] {
	$wsh = New-Object -ComObject Wscript.Shell
	$wsh.Popup('Cannot listen on localhost port 8080.`nMaybe something else is already running?', 0, 'HTTP Server Error', 48)
	exit
}

# Restrict access to virtual drive mapped to this directory.
New-PSDrive -Name Public -PSProvider FileSystem -Root $PWD.Path
cd Public:\

$enc = [system.Text.Encoding]::UTF8

do {
	$ctx = $app.GetContext()
	$req = $ctx.Request
	$res = $ctx.Response
	$url = $req.Url
	$code = 200
	$msg = ''

	Write-Host $url

	try {
		$reqPath = [System.IO.Path]::Combine('Public:\', $url.LocalPath)
		$file = Get-Item -LiteralPath $reqPath -Force -ErrorAction Stop

		if($file.Attributes -match 'Directory') {
			# Attempt to redirect directories to index.html files inside.
			$reqPath = [System.IO.Path]::Combine($reqPath, 'index.html')
			# This will throw if index.html is unavailable.
			$file = Get-Item -LiteralPath $reqPath -Force -ErrorAction Stop
			# Moved permanently.
			$code = 301
			$res.Headers.Add('location', ($url.Scheme + '://' + $url.Authority + $url.AbsolutePath.TrimEnd('/') + '/index.html'))
		} else {
			$path = $file.FullName
			$body = [System.IO.File]::ReadAllBytes($path)
			$res.ContentType = [System.Web.MimeMapping]::GetMimeMapping($path)
		}
	} catch [System.Management.Automation.ItemNotFoundException] {
		$code = 404
	} catch [System.UnauthorizedAccessException] {
		$code = 403
	} catch {
		$msg = '<p>' + $_.Exception.Message + '</p><p>' + $_.CategoryInfo.GetMessage() + '</p><p>' + $_.FullyQualifiedErrorId + '</p>'
		$code = 500
	}

	if($code -ne 200) {
		$res.StatusCode = $code
		$res.ContentType = 'text/html'

		$body = $enc.GetBytes('<h1>' + $code + ' ' + $([enum]::GetName([System.Net.HttpStatusCode], $code)) + '</h1>' + $msg)
	}

	# Suppress error message if client closes the connection.
	try {
		$res.ContentLength64 = $body.Length
		$res.OutputStream.Write($body, 0, $body.Length)
	} catch { }
	$res.Close()
} while($app.IsListening)
