# For MimeMapping
[System.Reflection.Assembly]::LoadWithPartialName("System.Web")

# Start web server listening only on localhost.
$app = New-Object System.Net.HttpListener
$app.Prefixes.Add("http://localhost:8080/")
$app.Prefixes.Add("http://127.0.0.1:8080/")

try {
	$app.Start()
} catch [System.Net.HttpListenerException] {
	$wsh = New-Object -ComObject Wscript.Shell
	$wsh.Popup("Cannot listen on localhost port 8080.`nMaybe something else is already running?", 0, "HTTP Server Error", 48)
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
	$code = 200
	$msg = ""

	Write-Host $req.Url

	try {
		$file = Get-Item -LiteralPath "Public:\$($req.Url.LocalPath)" -Force -ErrorAction Stop

		if($file.Attributes -match "Directory") {
			$code = 403;
		} else {
			$path = $file.FullName
			$body = [System.IO.File]::ReadAllBytes($path)
			$res.ContentType = [System.Web.MimeMapping]::GetMimeMapping($path)
		}
	} catch [System.Management.Automation.ItemNotFoundException] {
		$code = 404;
	} catch [System.UnauthorizedAccessException] {
		$code = 403;
	} catch {
		$msg = "<p>$($_.Exception.Message)</p><p>$($_.CategoryInfo.GetMessage())</p><p>$($_.FullyQualifiedErrorId)</p>"
		$code = 500;
	}

	if($code -ne 200) {
		$res.StatusCode = $code
		$res.ContentType = "text/html"

		$body = $enc.GetBytes("<h1>$code $([enum]::GetName([System.Net.HttpStatusCode], $code))</h1>$msg");
	}

	$res.ContentLength64 = $body.Length
	$res.OutputStream.Write($body, 0, $body.Length)
	$res.Close()
} while($app.IsListening)
