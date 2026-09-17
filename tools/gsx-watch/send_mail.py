#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GSX 更新看门狗邮件发送（仅用 python3 标准库，无需安装任何包）。

配置 etc/mail.ini（凭据由管理员在服务器上自行填写，勿提交仓库）：

    [smtp]
    host = smtp.qq.com
    port = 465
    user = yourname@example.com
    password = 请填写SMTP授权码
    from = yourname@example.com
    to = yourname@example.com

端口 465 走 SSL，587 走 STARTTLS。多个收件人用英文逗号分隔。
QQ/163 等邮箱需在邮箱设置里开启 SMTP 并生成"授权码"作为 password。

用法：
    send_mail.py --test                    发送测试邮件
    send_mail.py "<主题>" <正文文件路径>    发送通知

退出码：0=已发送；78=配置缺失或含占位符；其他=发送失败。
"""

import configparser
import os
import smtplib
import socket
import ssl
import sys
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr

PLACEHOLDERS = ("", "请填写", "__FILL__")


def load_conf(path):
    if not os.path.isfile(path):
        return None
    cp = configparser.ConfigParser()
    cp.read(path, encoding="utf-8")
    if not cp.has_section("smtp"):
        return None
    s = cp["smtp"]
    conf = {}
    for key in ("host", "port", "user", "password", "from", "to"):
        conf[key] = (s.get(key, "") or "").strip()
    for key in ("host", "user", "password", "from", "to"):
        if conf[key] in PLACEHOLDERS:
            return None
    try:
        conf["port"] = int(conf["port"] or "465")
    except ValueError:
        conf["port"] = 465
    return conf


def send(conf, subject, body):
    msg = MIMEText(body, "plain", "utf-8")
    msg["Subject"] = Header(subject, "utf-8")
    msg["From"] = formataddr((str(Header("GSX 更新看门狗", "utf-8")), conf["from"]))
    to_list = [x.strip() for x in conf["to"].split(",") if x.strip()]
    msg["To"] = ", ".join(to_list)
    ctx = ssl.create_default_context()
    if conf["port"] == 465:
        srv = smtplib.SMTP_SSL(conf["host"], conf["port"], context=ctx, timeout=30)
    else:
        srv = smtplib.SMTP(conf["host"], conf["port"], timeout=30)
        srv.starttls(context=ctx)
    try:
        srv.login(conf["user"], conf["password"])
        srv.sendmail(conf["from"], to_list, msg.as_string())
    finally:
        try:
            srv.quit()
        except Exception:
            pass


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ini = os.path.join(here, "..", "etc", "mail.ini")
    conf = load_conf(ini)
    if conf is None:
        sys.stderr.write("mail.ini 未配置或含占位符: %s\n" % ini)
        return 78

    args = sys.argv[1:]
    if not args:
        sys.stderr.write("用法: send_mail.py --test | <subject> <body-file>\n")
        return 2

    if args[0] == "--test":
        subject = "[GSX 更新看门狗] 测试邮件"
        body = "这是一封测试邮件。收到即表示 GSX 更新通知通道配置成功。\n"
    else:
        subject = args[0]
        if len(args) < 2:
            sys.stderr.write("缺少正文文件路径\n")
            return 2
        with open(args[1], "r", encoding="utf-8") as fh:
            body = fh.read()

    try:
        send(conf, subject, body)
    except smtplib.SMTPAuthenticationError as exc:
        sys.stderr.write("SMTP 认证失败（检查授权码）: %s\n" % exc)
        return 5
    except (socket.timeout, smtplib.SMTPException, ssl.SSLError, OSError) as exc:
        sys.stderr.write("SMTP 发送失败: %s\n" % exc)
        return 4
    return 0


if __name__ == "__main__":
    sys.exit(main())
